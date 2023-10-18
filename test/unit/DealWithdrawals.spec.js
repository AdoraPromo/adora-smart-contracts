const { ethers } = require("hardhat")
const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")
const { time } = require("@nomicfoundation/hardhat-network-helpers")

const { BigNumber } = ethers

const { decodeResult } = require("@chainlink/functions-toolkit")

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

describe("Deal withdrawals", () => {
  const deployMarketplace = async () => {
    const [owner, sponsor, creator] = await ethers.getSigners()

    // NOTE: Registry address locally
    //       https://docs.tableland.xyz/smart-contracts/deployed-contracts#registry-contract
    const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"
    const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)

    const ApeCoin = await ethers.getContractFactory("ApeCoin")
    const apeCoin = await ApeCoin.deploy("ApeCoin", "APE", 100)

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
    await (await database.setWriter(marketplace.address)).wait()

    return { marketplace, database, apeCoin, tablelandRegistry, owner, sponsor, creator }
  }

  it("reverts when caller is not deal sponsor", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    await createDeal(marketplace, apeCoin, sponsor)

    aw
  })

  it("reverts when creator has accepted the deal and it has not expired", async () => {})

  it("withdraws a deal", async () => {})
})
