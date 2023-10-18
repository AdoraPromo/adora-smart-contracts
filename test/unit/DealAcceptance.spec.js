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

const createAndAcceptDeal = async (marketplace, database, apeCoin, sponsor, creator) => {
  const dealId = await createDeal(marketplace, apeCoin, sponsor)

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

  return dealId
}

describe("Deal acceptance", () => {
  before(async () => {
    const setup = await setupFunctionsTestnet()

    functionsRouterContract = setup.functionsRouterContract
    addConsumerContractToSubscription = setup.addConsumerContractToSubscription
    donId = setup.donId
  })

  const deployMarketplace = async ({ acceptError = null } = {}) => {
    const [owner, sponsor, creator] = await ethers.getSigners()

    const ApeCoin = await ethers.getContractFactory("ApeCoin")
    const apeCoin = await ApeCoin.deploy("ApeCoin", "APE", 100)

    const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"
    const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)

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

    const acceptFunctionSource = acceptError ? `throw Error("${acceptError}");` : "return Functions.encodeUint256(1)"

    await (await marketplace.setAcceptFunctionSource(acceptFunctionSource)).wait()
    await (await marketplace.setSubscriptionId(1)).wait()

    await (await database.setWriter(marketplace.address)).wait()

    await addConsumerContractToSubscription(marketplace.address)

    return { marketplace, database, apeCoin, tablelandRegistry, owner, sponsor, creator }
  }

  it("reverts when accepting a deal with an ID that does not exist", async () => {
    const { marketplace, apeCoin, sponsor } = await deployMarketplace()

    await createDeal(marketplace, apeCoin, sponsor)

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")
    const dealId = ethers.utils.formatBytes32String("")

    await expect(marketplace.acceptDeal(dealId, accountOwnershipProof)).to.be.revertedWithCustomError(
      marketplace,
      "DealDoesNotExist"
    )
  })

  it("reverts when account ownership proof not provided", async () => {
    const { marketplace, apeCoin, sponsor } = await deployMarketplace()

    const dealId = await createDeal(marketplace, apeCoin, sponsor)

    const accountOwnershipProof = ""

    await expect(marketplace.acceptDeal(dealId, accountOwnershipProof)).to.be.revertedWithCustomError(
      marketplace,
      "AccountOwnershipProofMissing"
    )
  })

  it("reverts if the deal has expired", async () => {
    const { marketplace, apeCoin, sponsor } = await deployMarketplace()

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 123

    const dealId = await createDeal(marketplace, apeCoin, sponsor, { redemptionExpiration })

    await time.setNextBlockTimestamp(redemptionExpiration + 1)

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    await expect(marketplace.acceptDeal(dealId, accountOwnershipProof)).to.be.revertedWithCustomError(
      marketplace,
      "DealExpired"
    )
  })

  it("accepts a deal", async () => {
    const { marketplace, database, apeCoin, sponsor, creator } = await deployMarketplace()

    await createAndAcceptDeal(marketplace, database, apeCoin, sponsor, creator)
  })

  it("does not accept a deal when account verification fails", async () => {
    const acceptError = "Account ownership failed"
    const { marketplace, database, apeCoin, sponsor, creator } = await deployMarketplace({ acceptError })

    const dealId = await createDeal(marketplace, apeCoin, sponsor)

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    const acceptTx = await (await marketplace.connect(creator).acceptDeal(dealId, accountOwnershipProof)).wait()

    // TODO: figure out if we can handle this in a better way
    await new Promise((resolve) => setTimeout(resolve, 10000))

    const errorFilter = marketplace.filters.FunctionError()
    const errorLogs = await marketplace.queryFilter(errorFilter)
    expect(errorLogs.length).to.eq(1)
    expect(decodeResult(errorLogs[0].args.errorMessage, "string")).to.eq(acceptError)

    const dealFromContract = await marketplace.getDeal(dealId)
    expect(dealFromContract.status).to.eq(0)

    expect(dealFromContract.creator).to.eq(creator.address)

    const tableName = await database.s_tableName()
    const selectLastDeal = encodeURIComponent(`select * from ${tableName} LIMIT 1`)
    const response = await fetch(`http://localhost:8080/api/v1/query?statement=${selectLastDeal}`)
    const dealRows = await response.json()
    const dealFromDB = dealRows[0]

    expect(dealRows.length).to.eq(1)

    expect(dealFromDB.id).not.to.eq(null)
    expect(dealFromDB.status).to.eq("New")
    expect(dealFromDB.sponsor_address).to.eq(sponsor.address.toLowerCase())
    expect(dealFromDB.creator_address).to.eq("0x00")
  })

  it("reverts if the deal is already accepted", async () => {
    const { marketplace, database, apeCoin, sponsor, creator } = await deployMarketplace()

    const dealId = await createAndAcceptDeal(marketplace, database, apeCoin, sponsor, creator)

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    await expect(marketplace.acceptDeal(dealId, accountOwnershipProof)).to.be.revertedWithCustomError(
      marketplace,
      "DealStatusMustBeNew"
    )
  })
})
