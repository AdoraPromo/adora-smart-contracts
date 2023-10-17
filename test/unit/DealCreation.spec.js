const { ethers } = require("hardhat")
const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")
const { time } = require("@nomicfoundation/hardhat-network-helpers")

const { BigNumber } = ethers

describe("Deal creation", () => {
  const deployMarketplace = async () => {
    const [owner, sponsor, creator] = await ethers.getSigners()

    const ApeCoin = await ethers.getContractFactory("ApeCoin")
    const apeCoin = await ApeCoin.deploy("ApeCoin", "APE", 100)

    const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"
    const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)

    const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
    const marketplace = await Marketplace.deploy(apeCoin.address, { gasLimit: 2000000 })

    return { marketplace, apeCoin, tablelandRegistry, owner, sponsor, creator }
  }

  it("reverts when payment token allowance is not set", async () => {
    const { marketplace, sponsor } = await deployMarketplace()

    const termsHash = ethers.utils.formatBytes32String("termsHash")
    const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
    const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
    const maxPayment = 123
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 1010

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "MaxValueAllowanceMissing")
  })

  it("reverts when terms hash not set", async () => {
    const { marketplace, apeCoin, sponsor } = await deployMarketplace()

    const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
    const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
    const maxPayment = 123
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 1010

    await (await apeCoin.connect(sponsor).increaseAllowance(marketplace.address, maxPayment)).wait()

    const termsHash = ethers.utils.formatBytes32String("")

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "TermsHashMissing")
  })

  it("reverts when encrypted symmetric key not set", async () => {
    const { marketplace, apeCoin, sponsor } = await deployMarketplace()

    const termsHash = ethers.utils.formatBytes32String("termsHash")
    const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
    const maxPayment = 123
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 1010

    await (await apeCoin.connect(sponsor).increaseAllowance(marketplace.address, maxPayment)).wait()

    const encryptedSymmetricKey = ""

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "EncryptedSymmetricKeyMissing")
  })

  it("reverts when encrypted terms not set", async () => {
    const { marketplace, apeCoin, sponsor } = await deployMarketplace()

    const termsHash = ethers.utils.formatBytes32String("termsHash")
    const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
    const maxPayment = 123
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 1010

    await (await apeCoin.connect(sponsor).increaseAllowance(marketplace.address, maxPayment)).wait()

    const encryptedTerms = ""

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "EncryptedTermsMissing")
  })

  it("reverts when max payment not set", async () => {
    const { marketplace, sponsor } = await deployMarketplace()

    const termsHash = ethers.utils.formatBytes32String("termsHash")
    const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
    const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
    const maxPayment = 0
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 1010

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "MaxPaymentMissing")
  })

  it("reverts when redemption expiration is in past", async () => {
    const { marketplace, sponsor } = await deployMarketplace()

    const termsHash = ethers.utils.formatBytes32String("termsHash")
    const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
    const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
    const maxPayment = 123
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    // Past timestamp
    const redemptionExpiration = latestTimestamp - 100

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "RedemptionExpirationMustBeInFuture")
  })

  it("reverts when redemption expiration is the current time", async () => {
    const { marketplace, sponsor } = await deployMarketplace()

    const termsHash = ethers.utils.formatBytes32String("termsHash")
    const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
    const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
    const maxPayment = 123
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const nextTimestamp = latestTimestamp + 1

    await time.setNextBlockTimestamp(nextTimestamp)

    // Past timestamp
    const redemptionExpiration = nextTimestamp

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "RedemptionExpirationMustBeInFuture")
  })

  it("reverts when an exact copy of deal already exists", async () => {
    const { marketplace, apeCoin, sponsor } = await deployMarketplace()

    const termsHash = ethers.utils.formatBytes32String("termsHash")
    const encryptedSymmetricKey = Buffer.from("encryptedSymmetricKey").toString("base64")
    const encryptedTerms = Buffer.from("encryptedTerms").toString("base64")
    const maxPayment = 123
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp
    const redemptionExpiration = latestTimestamp + 1010

    // NOTE: You can see that we increase allowance only once here and it still works.
    //       Let's think about if that makes sense.
    await (await apeCoin.connect(sponsor).increaseAllowance(marketplace.address, maxPayment)).wait()

    await await marketplace
      .connect(sponsor)
      .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
        gasLimit: 2000000,
      })

    await expect(
      marketplace
        .connect(sponsor)
        .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
          gasLimit: 2000000,
        })
    ).to.be.revertedWithCustomError(marketplace, "DealAlreadyExists")
  })

  it("creates a deal onchain and in Tableland", async () => {
    const { marketplace, apeCoin, tablelandRegistry, sponsor } = await deployMarketplace()

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
    const redemptionExpiration = latestTimestamp + 1010

    await (await apeCoin.connect(sponsor).increaseAllowance(marketplace.address, maxPayment)).wait()

    const tx = marketplace
      .connect(sponsor)
      .createDeal(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration, {
        gasLimit: 2000000,
      })

    const dealsTableName = await marketplace.s_tableName()

    await expect(tx)
      .to.emit(marketplace, "DealCreated")
      .and.to.emit(tablelandRegistry, "RunSQL")
      .withArgs(marketplace.address, anyValue, anyValue, anyValue, anyValue)

    // TODO: is there another way we can wait for the table to be fully available here?
    await new Promise((resolve) => setTimeout(resolve, 10000))

    const tableName = await marketplace.s_tableName()
    const selectLastDeal = encodeURIComponent(`select * from ${tableName} LIMIT 1`)
    const response = await fetch(`http://localhost:8080/api/v1/query?statement=${selectLastDeal}`)
    const dealRows = await response.json()
    const deal = dealRows[0]

    expect(dealRows.length).to.eq(1)

    expect(deal.id).not.to.eq(null)
    expect(deal.status).to.eq("New")
    expect(deal.sponsor_address).to.eq(sponsor.address.toLowerCase())
    expect(deal.creator_address).to.eq("0x00")

    // Base64 decoding
    const decodedTermsHash = ethers.utils.base64.decode(deal.terms_hash)

    // Unpacking
    const decodedValues = ethers.utils.defaultAbiCoder.decode(["bytes32"], decodedTermsHash)
    const termsHashByte32 = decodedValues[0]

    expect(termsHashByte32).to.eq(termsHash)
    expect(deal.encrypted_symmetric_key).to.eq(encryptedSymmetricKey)
    expect(deal.encrypted_terms).to.eq(encryptedTerms)
    expect(deal.encrypted_tweet_id).to.eq(null)
    expect(deal.max_payment).to.eq(`0x${maxPayment.toString("16")}`)
    expect(deal.redeemed_amount).to.eq(null)
    expect(deal.redemption_expiration).to.eq(redemptionExpiration)
  })
})
