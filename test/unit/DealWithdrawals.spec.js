const { ethers } = require("hardhat")
const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")
const { time } = require("@nomicfoundation/hardhat-network-helpers")

const { BigNumber } = ethers

const { decodeResult } = require("@chainlink/functions-toolkit")
const { setupFunctionsTestnet } = require("../utils/utils")

let addConsumerContractToSubscription
let functionsRouterContract
let donId

const SPONSOR_INITIAL_BALANCE = 200000
const OWNER_INITIAL_BALANCE = 1000000

const createDeal = async (marketplace, apeCoin, sponsor, options = {}) => {
  const terms = {
    twitterUserId: 123123123,
    paymentPerLike: "0x123",
    sponsorshipCriteria: "Write something about John Doe Furniture, Inc",
  }

  const termsHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(terms)))
  const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
  const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
  const maxPayment = 123
  const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
  const redemptionExpiration = options.redemptionExpiration ? options.redemptionExpiration : latestTimestamp + 1010

  await (await apeCoin.connect(sponsor).increaseAllowance(marketplace.address, maxPayment)).wait()

  const createDealTx = await (
    await marketplace
      .connect(sponsor)
      .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
        gasLimit: 2000000,
      })
  ).wait()

  const dealCreatedEvent = createDealTx.logs
    .map((log) => {
      try {
        return marketplace.interface.parseLog(log)
      } catch {
        return null
      }
    })
    .filter((parsedLog) => parsedLog !== null)[0]

  return dealCreatedEvent.args.dealId
}

describe("Deal withdrawals", () => {
  before(async () => {
    const setup = await setupFunctionsTestnet()

    functionsRouterContract = setup.functionsRouterContract
    addConsumerContractToSubscription = setup.addConsumerContractToSubscription
    donId = setup.donId
  })

  const deployMarketplace = async () => {
    const [owner, sponsor, creator] = await ethers.getSigners()

    // NOTE: Registry address locally
    //       https://docs.tableland.xyz/smart-contracts/deployed-contracts#registry-contract
    const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"
    const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)

    const ApeCoin = await ethers.getContractFactory("ApeCoin")
    const apeCoin = await ApeCoin.deploy("ApeCoin", "APE", OWNER_INITIAL_BALANCE)
    await (await apeCoin.transfer(sponsor.address, SPONSOR_INITIAL_BALANCE)).wait()

    const Database = await ethers.getContractFactory("Database")
    const database = await Database.deploy()
    await database.deployed()

    const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
    const marketplace = await Marketplace.deploy(
      functionsRouterContract.address,
      ethers.utils.formatBytes32String(donId),
      apeCoin.address,
      database.address,
      { gasLimit: 30000000 }
    )

    await (await marketplace.setAcceptFunctionSource("return Functions.encodeUint256(1)")).wait()
    await (await marketplace.setSubscriptionId(1)).wait()
    await (await database.setWriter(marketplace.address)).wait()

    await addConsumerContractToSubscription(marketplace.address)

    return { marketplace, database, apeCoin, tablelandRegistry, owner, sponsor, creator }
  }

  // TODO: reuse all of the helper functions in tests
  const createAndAcceptDeal = async (options) => {
    const { marketplace, database, apeCoin, sponsor, creator, owner, redemptionExpiration } = options
    const maxPayment = 123
    const dealId = await createDeal(marketplace, apeCoin, sponsor, { maxPayment, redemptionExpiration })
    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    const acceptTx = await (await marketplace.connect(creator).acceptDeal(dealId, accountOwnershipProof)).wait()

    // TODO: figure out if we can handle this in a better way
    await new Promise((resolve) => setTimeout(resolve, 10000))

    const filter = functionsRouterContract.filters.RequestProcessed()
    const logs = await functionsRouterContract.queryFilter(filter)
    const requestProcessedEvent = logs[0]
    const functionsResponse = requestProcessedEvent.args.response

    expect(functionsResponse).to.eq(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 32))

    const dealFromContract = await marketplace.getDeal(dealId)
    expect(dealFromContract.status).to.eq(1)

    expect(dealFromContract.creator).to.eq(creator.address)

    const tableName = await database.s_tableName()
    const selectLastDeal = encodeURIComponent(`select * from ${tableName} LIMIT 1`)
    const response = await fetch(`http://localhost:8080/api/v1/query?statement=${selectLastDeal}`)
    const dealRows = await response.json()
    const dealFromDB = dealRows[0]

    expect(dealRows.length).to.eq(1)

    expect(dealFromDB.id).not.to.eq(null)
    expect(dealFromDB.status).to.eq("Accepted")
    expect(dealFromDB.sponsor_address).to.eq(sponsor.address.toLowerCase())
    expect(dealFromDB.creator_address).to.eq(creator.address.toLowerCase())

    expect(await apeCoin.balanceOf(sponsor.address)).to.eq(SPONSOR_INITIAL_BALANCE - dealFromContract.maxPayment)
    expect(await apeCoin.balanceOf(owner.address)).to.eq(OWNER_INITIAL_BALANCE - SPONSOR_INITIAL_BALANCE)
    expect(await apeCoin.balanceOf(marketplace.address)).to.eq(maxPayment)

    return dealId
  }

  it("reverts when caller is not deal sponsor", async () => {
    const { marketplace, apeCoin, sponsor, creator } = await deployMarketplace()

    const dealId = await createDeal(marketplace, apeCoin, sponsor)

    await expect(marketplace.connect(creator).withdrawDeal(dealId)).to.be.revertedWithCustomError(
      marketplace,
      "CannotWithdraw"
    )
  })

  it("reverts when creator has accepted the deal and it has not expired", async () => {
    const { marketplace, database, apeCoin, sponsor, creator, owner } = await deployMarketplace()

    const options = { marketplace, database, apeCoin, sponsor, creator, owner }
    const dealId = await createAndAcceptDeal(options)

    await expect(marketplace.connect(creator).withdrawDeal(dealId)).to.be.revertedWithCustomError(
      marketplace,
      "CannotWithdraw"
    )
  })

  it("withdraws a deal when it is new", async () => {
    const { marketplace, database, apeCoin, sponsor } = await deployMarketplace()

    const dealId = await createDeal(marketplace, apeCoin, sponsor)

    await expect(marketplace.connect(sponsor).withdrawDeal(dealId)).to.be.emit(marketplace, "DealWithdrawn")

    // TODO: figure out if we can handle this in a better way
    await new Promise((resolve) => setTimeout(resolve, 10000))

    const dealFromContract = await marketplace.getDeal(dealId)
    expect(dealFromContract.status).to.eq(3)

    expect(await apeCoin.balanceOf(sponsor.address)).to.eq(SPONSOR_INITIAL_BALANCE)

    const tableName = await database.s_tableName()
    const selectLastDeal = encodeURIComponent(`select * from ${tableName} LIMIT 1`)
    const response = await fetch(`http://localhost:8080/api/v1/query?statement=${selectLastDeal}`)
    const dealRows = await response.json()
    const dealFromDB = dealRows[0]

    expect(dealRows.length).to.eq(1)

    expect(dealFromDB.id).not.to.eq(null)
    expect(dealFromDB.status).to.eq("Withdrawn")
  })

  it("withdraws a deal when it is accepted and has expired", async () => {
    const { marketplace, database, apeCoin, sponsor, creator, owner } = await deployMarketplace()

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 1010

    const options = { marketplace, database, apeCoin, sponsor, creator, owner, redemptionExpiration }
    const dealId = await createAndAcceptDeal(options)

    await time.setNextBlockTimestamp(redemptionExpiration + 1)

    await expect(marketplace.connect(sponsor).withdrawDeal(dealId)).to.be.emit(marketplace, "DealWithdrawn")

    // TODO: figure out if we can handle this in a better way
    await new Promise((resolve) => setTimeout(resolve, 10000))

    const dealFromContract = await marketplace.getDeal(dealId)
    expect(dealFromContract.status).to.eq(3)

    expect(await apeCoin.balanceOf(sponsor.address)).to.eq(SPONSOR_INITIAL_BALANCE)

    const tableName = await database.s_tableName()
    const selectLastDeal = encodeURIComponent(`select * from ${tableName} LIMIT 1`)
    const response = await fetch(`http://localhost:8080/api/v1/query?statement=${selectLastDeal}`)
    const dealRows = await response.json()
    const dealFromDB = dealRows[0]

    expect(dealRows.length).to.eq(1)

    expect(dealFromDB.id).not.to.eq(null)
    expect(dealFromDB.status).to.eq("Withdrawn")
  })
})
