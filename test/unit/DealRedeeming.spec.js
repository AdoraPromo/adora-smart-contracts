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

  await (await apeCoin.transfer(sponsor.address, 200000)).wait()
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

const redeemDeal = async (options) => {
  const { marketplace, database, apeCoin, sponsor, creator, redeemAmount } = options

  const dealId = await createAndAcceptDeal(marketplace, database, apeCoin, sponsor, creator)

  const encryptedTweetId = Buffer.from("encryptedTweetId").toString("base64")

  const redeemTx = await (await marketplace.connect(creator).redeemDeal(dealId, encryptedTweetId)).wait()

  // TODO: figure out if we can handle this in a better way
  await new Promise((resolve) => setTimeout(resolve, 10000))

  // TODO: why doesn't this emit the RequestProcessed event?
  // const filter = functionsRouterContract.filters.RequestProcessed()
  // const logs = await marketplace.queryFilter(filter)
  // console.log(await marketplace.queryFilter({}))
  // expect(filter.length).to.eq(1)
  // expect(decodeResult(logs[0].args.response, "uint256")).to.eq(redeemAmount)

  const dealFromContract = await marketplace.getDeal(dealId)
  expect(dealFromContract.status).to.eq(2) // 1 => Redeemed

  const tableName = await database.s_tableName()
  const selectLastDeal = encodeURIComponent(`select * from ${tableName} LIMIT 1`)

  const response = await fetch(`http://localhost:8080/api/v1/query?statement=${selectLastDeal}`)
  const dealRows = await response.json()
  const dealFromDB = dealRows[0]

  expect(dealRows.length).to.eq(1)

  expect(dealFromDB.id).not.to.eq(null)
  expect(dealFromDB.status).to.eq("Redeemed")

  const payout = redeemAmount > dealFromContract.maxPayment ? dealFromContract.maxPayment : redeemAmount

  expect(dealFromDB.redeemed_amount).to.eq(payout.toString())

  expect(await apeCoin.balanceOf(creator.address)).to.eq(payout)

  return dealId
}

describe.only("Deal redeeming", () => {
  before(async () => {
    const setup = await setupFunctionsTestnet()

    functionsRouterContract = setup.functionsRouterContract
    addConsumerContractToSubscription = setup.addConsumerContractToSubscription
    donId = setup.donId
  })

  const deployMarketplace = async ({ redeemError = null, redeemAmount = 0 } = {}) => {
    const [owner, sponsor, creator, creator2] = await ethers.getSigners()

    const ApeCoin = await ethers.getContractFactory("ApeCoin")
    const apeCoin = await ApeCoin.deploy("ApeCoin", "APE", 1000000)

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

    const acceptFunctionSource = "return Functions.encodeUint256(1)"
    const redeemFunctionSource = redeemError
      ? `throw Error("${redeemError}");`
      : `return Functions.encodeUint256(${redeemAmount})`

    await (await marketplace.setAcceptFunctionSource(acceptFunctionSource)).wait()
    await (await marketplace.setRedeemFunctionSource(redeemFunctionSource)).wait()

    await (await marketplace.setSubscriptionId(1)).wait()

    await (await database.setWriter(marketplace.address)).wait()

    await addConsumerContractToSubscription(marketplace.address)

    return { marketplace, database, apeCoin, tablelandRegistry, owner, sponsor, creator, creator2 }
  }

  it("reverts when redeeming a deal that does not exist", async () => {
    const { marketplace, apeCoin, sponsor, creator } = await deployMarketplace()

    const encryptedTweetId = Buffer.from("encryptedTweetId").toString("base64")
    const fakeDealId = ethers.utils.formatBytes32String("fakeDealId")

    await expect(marketplace.connect(creator).redeemDeal(fakeDealId, encryptedTweetId)).to.revertedWithCustomError(
      marketplace,
      "InvalidDealId"
    )
  })

  it("reverts when encrypted tweet ID not provided", async () => {
    const { marketplace, apeCoin, sponsor, creator } = await deployMarketplace()

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 123

    const dealId = await createDeal(marketplace, apeCoin, sponsor, { redemptionExpiration })

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    await (await marketplace.connect(creator).acceptDeal(dealId, accountOwnershipProof)).wait()

    await expect(marketplace.connect(creator).redeemDeal(dealId, "")).to.revertedWithCustomError(
      marketplace,
      "EncryptedTweetIdMissing"
    )
  })

  it("reverts when redeeming a new deal", async () => {
    const { marketplace, apeCoin, sponsor, creator } = await deployMarketplace()

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 123

    const dealId = await createDeal(marketplace, apeCoin, sponsor, { redemptionExpiration })

    const encryptedTweetId = Buffer.from("encryptedTweetId").toString("base64")

    await expect(marketplace.connect(creator).redeemDeal(dealId, encryptedTweetId)).to.revertedWithCustomError(
      marketplace,
      "InvalidDealId"
    )
  })

  it("reverts when redeeming an expired deal", async () => {
    const { marketplace, apeCoin, sponsor, creator } = await deployMarketplace()

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 123

    const dealId = await createDeal(marketplace, apeCoin, sponsor, { redemptionExpiration })

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    await (await marketplace.connect(creator).acceptDeal(dealId, accountOwnershipProof)).wait()

    await new Promise((resolve) => setTimeout(resolve, 10000))

    const filter = functionsRouterContract.filters.RequestProcessed()
    const logs = await functionsRouterContract.queryFilter(filter)
    const requestProcessedEvent = logs[0]
    const functionsResponse = requestProcessedEvent.args.response

    expect(functionsResponse).to.eq(ethers.utils.hexZeroPad(ethers.utils.hexlify(1), 32))

    await time.setNextBlockTimestamp(redemptionExpiration + 1)

    const encryptedTweetId = Buffer.from("encryptedTweetId").toString("base64")

    await expect(marketplace.connect(creator).redeemDeal(dealId, encryptedTweetId)).to.revertedWithCustomError(
      marketplace,
      "DealExpired"
    )
  })

  it("reverts when redeeming other creator's deal", async () => {
    const { marketplace, apeCoin, sponsor, creator, creator2 } = await deployMarketplace()

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 123

    const dealId = await createDeal(marketplace, apeCoin, sponsor, { redemptionExpiration })

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    await (await marketplace.connect(creator).acceptDeal(dealId, accountOwnershipProof)).wait()

    const encryptedTweetId = Buffer.from("encryptedTweetId").toString("base64")

    await expect(marketplace.connect(creator2).redeemDeal(dealId, encryptedTweetId)).to.revertedWithCustomError(
      marketplace,
      "InvalidDealId"
    )
  })

  it("does not redeem a deal when the redeem function rejects it", async () => {
    const redeemError = "Tweet does not match requirements"
    const { marketplace, database, apeCoin, sponsor, creator } = await deployMarketplace({ redeemError })

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 123

    const dealId = await createDeal(marketplace, apeCoin, sponsor, { redemptionExpiration })

    const accountOwnershipProof = Buffer.from("accountOwnershipProof").toString("base64")

    await (await marketplace.connect(creator).acceptDeal(dealId, accountOwnershipProof)).wait()

    // TODO: figure out if we can handle this in a better way
    await new Promise((resolve) => setTimeout(resolve, 10000))

    const encryptedTweetId = Buffer.from("encryptedTweetId").toString("base64")

    const redeemTx = await (await marketplace.connect(creator).redeemDeal(dealId, encryptedTweetId)).wait()

    // TODO: figure out if we can handle this in a better way
    await new Promise((resolve) => setTimeout(resolve, 10000))

    const errorFilter = marketplace.filters.FunctionError()
    const errorLogs = await marketplace.queryFilter(errorFilter)
    expect(errorLogs.length).to.eq(1)
    expect(decodeResult(errorLogs[0].args.errorMessage, "string")).to.eq(redeemError)

    const dealFromContract = await marketplace.getDeal(dealId)
    expect(dealFromContract.status).to.eq(1) // 1 => Accepted

    const tableName = await database.s_tableName()
    const selectLastDeal = encodeURIComponent(`select * from ${tableName} LIMIT 1`)
    const response = await fetch(`http://localhost:8080/api/v1/query?statement=${selectLastDeal}`)
    const dealRows = await response.json()
    const dealFromDB = dealRows[0]

    expect(dealRows.length).to.eq(1)

    expect(dealFromDB.id).not.to.eq(null)
    expect(dealFromDB.status).to.eq("Accepted")
    expect(dealFromDB.redeemed_amount).to.eq(null)
  })

  it("reverts when redeeming an already redeemed deal", async () => {
    const redeemAmount = 123456
    const { marketplace, database, apeCoin, sponsor, creator } = await deployMarketplace({ redeemAmount })

    const options = {
      marketplace,
      database,
      apeCoin,
      sponsor,
      creator,
      redeemAmount,
    }

    const dealId = await redeemDeal(options)

    const encryptedTweetId = Buffer.from("doesNotMatter").toString("base64")

    await expect(marketplace.connect(creator).redeemDeal(dealId, encryptedTweetId)).to.be.revertedWithCustomError(
      marketplace,
      "InvalidDealId"
    )
  })

  it("redeems a deal", async () => {
    const redeemAmount = 123456
    const { marketplace, database, apeCoin, sponsor, creator } = await deployMarketplace({ redeemAmount })

    const options = {
      marketplace,
      database,
      apeCoin,
      sponsor,
      creator,
      redeemAmount,
    }

    await redeemDeal(options)
  })
})
