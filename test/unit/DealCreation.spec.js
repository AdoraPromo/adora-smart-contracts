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

  const createDeal = async (marketplace, sponsor, creator) => {
    const creatorData = {
      // NOTE: just using address instead of UUID for convenience
      id: creator.address,
      accountAddress: creator.address,
    }

    const sponsorData = {
      // NOTE: just using address instead of UUID for convenience
      id: sponsor.address,
      accountAddress: sponsor.address,
    }

    const proposalData = {
      // NOTE: just using addresses instead of UUID for convenience
      id: creator.address.slice(-20) + sponsor.address.slice(-20),
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 123,
    }

    await (
      await marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData, { gasLimit: 2000000 })
    ).wait()

    return proposalData.id
  }

  it("reverts when empty deal ID is provided", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      // NOTE: just using address instead of UUID for convenience
      id: creator.address,
      accountAddress: creator.address,
    }

    const sponsorData = {
      // NOTE: just using address instead of UUID for convenience
      id: sponsor.address,
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 123,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData, { gasLimit: 2000000 })
    ).to.be.revertedWithCustomError(marketplace, "DealIdMissing")
  })

  it("reverts when deal with provided ID already exists", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const dealId = await createDeal(marketplace, sponsor, creator)

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: dealId,
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 123,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "DealAlreadyExists")
  })

  it("reverts when delivery deadline is in past", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp - 1,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "DeliveryDeadlineMustBeInFuture")
  })

  it("reverts when delivery deadline is current timestamp", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "DeliveryDeadlineMustBeInFuture")
  })

  it("reverts when proposal does not have a creator ID", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: "",
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "CreatorIdMissing")
  })

  it("reverts when proposal creator ID does not match creator record ID", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: "different-than-above",
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "CreatorIdsDiffer")
  })

  it("reverts when proposal does not have a sponsor ID", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: "",
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "SponsorIdMissing")
  })

  it("reverts when proposal sponsor ID does not match sponsor record ID", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: "different-than-above",
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 1,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "SponsorIdsDiffer")
  })

  it("reverts when sponsor address does not match tx sender", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: creator.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 1,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "SponsorAddressMustMatchSender")
  })

  it("reverts when no deal requirements are provided", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 1,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "RequirementsMissing")
  })

  it("reverts when no payment per like provided", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 0,
      requirements: "Post this url: asdf.com",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 123,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "PaymentPerLikeMissing")
  })

  it("reverts when no max payment amount provided", async () => {
    const { marketplace, sponsor, creator } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: 0,
      paymentPerLike: 1000000,
      requirements: "Post this url: asdf.com",
      deliveryDeadline: (await ethers.provider.getBlock("latest")).timestamp + 123,
    }

    await expect(
      marketplace.connect(sponsor).createDeal(creatorData, sponsorData, proposalData)
    ).to.be.revertedWithCustomError(marketplace, "MaxPaymentAmountMissing")
  })

  it("Creates the deal and writes creator and sponsor data to tableland", async () => {
    const { marketplace, apeCoin, tablelandRegistry, creator, sponsor } = await deployMarketplace()

    const creatorData = {
      id: "26fecf0b-8238-48b2-b93e-854f2a8cdb10",
      accountAddress: creator.address,
    }

    const sponsorData = {
      id: "865a22fc-1986-4205-8ffc-8916c1132cdc",
      accountAddress: sponsor.address,
    }

    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp

    const proposalData = {
      id: "592a4299-f7e2-459b-8902-86053f387b0c",
      creatorId: creatorData.id,
      sponsorId: sponsorData.id,
      maxPaymentAmount: ethers.utils.parseEther("0.01"),
      paymentPerLike: 100000,
      requirements: "Post this URL in a tweet: mystuff.promo",
      deliveryDeadline: latestTimestamp + 123,
    }

    const nextBlockTimestamp = latestTimestamp + 1

    await time.setNextBlockTimestamp(nextBlockTimestamp)

    const tx = await marketplace
      .connect(sponsor)
      .createDeal(creatorData, sponsorData, proposalData, { gasLimit: 2000000 })

    const dealsTableIdx = await marketplace.DEALS_TABLE_INDEX()
    const dealsTableName = await marketplace.s_tableNames(dealsTableIdx)

    const insertStatement = `INSERT INTO ${dealsTableName}(id,creator_id,sponsor_id,status,max_payment_amount,payment_per_like,payment_token,requirements,created_at,delivery_deadline)VALUES('${
      proposalData.id
    }','${creatorData.id}','${sponsorData.id}','NEW',${proposalData.maxPaymentAmount},${
      proposalData.paymentPerLike
    },'${apeCoin.address.toLowerCase()}','Post this URL in a tweet: mystuff.promo',${nextBlockTimestamp},${
      proposalData.deliveryDeadline
    })`

    await expect(tx)
      .to.emit(marketplace, "DealCreated")
      .withArgs(proposalData.id)
      .and.to.emit(tablelandRegistry, "RunSQL")
      .withArgs(marketplace.address, anyValue, anyValue, insertStatement, anyValue)
  })
})
