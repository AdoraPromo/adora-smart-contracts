const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")

const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")

describe("Sponsorship Marketplace", async function () {
  const deployMarketplace = async () => {
    const [owner, sponsor, creator] = await ethers.getSigners()

    const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
    const marketplace = await Marketplace.deploy({ gasLimit: 2000000 })

    return { marketplace, owner, sponsor, creator }
  }

  const createOffer = async (marketplace, sponsor) => {
    const offerId = ethers.utils.hexlify(ethers.utils.randomBytes(32))

    const timestamp = (await ethers.provider.getBlock("latest")).timestamp + 123
    const offerData = ethers.utils.toUtf8Bytes("Some data here")

    await (await marketplace.createOffer(offerId, timestamp, offerData)).wait()

    return offerId
  }

  describe("Deployment", async () => {
    it("mints the offers table", async () => {
      const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")

      const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"

      const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)

      const marketplace = await Marketplace.deploy({ gasLimit: 2000000 })
      await marketplace.deployed()

      // TODO: for some reason hre.network.config is empty
      const chainId = 31337

      // TODO: change this to the actual fields stored on Tableland
      await expect(marketplace.deployTransaction)
        .to.emit(tablelandRegistry, "CreateTable")
        .withArgs(
          marketplace.address,
          anyValue,
          `CREATE TABLE offers_${chainId} (id integer primary key, offerData text);`
        )
    })
  })

  describe("Offer creation", async () => {
    it("reverts when offer ID of zero is provided", async () => {
      const { marketplace, sponsor } = await deployMarketplace()

      const acceptExpirationTimestamp = (await ethers.provider.getBlock("latest")).timestamp + 123
      const offerData = ethers.utils.toUtf8Bytes("Some data here")

      await expect(marketplace.createOffer(0, acceptExpirationTimestamp, offerData)).to.be.revertedWithCustomError(
        marketplace,
        "OfferIdMissing"
      )
    })

    it("reverts when offer with provided ID already exists", async () => {
      const { marketplace, sponsor } = await deployMarketplace()

      const offerId = createOffer(marketplace, sponsor)
      const acceptExpirationTimestamp = (await ethers.provider.getBlock("latest")).timestamp + 123
      const offerData = ethers.utils.toUtf8Bytes("Some data here")

      await expect(
        marketplace.createOffer(offerId, acceptExpirationTimestamp, offerData)
      ).to.be.revertedWithCustomError(marketplace, "OfferAlreadyExists")
    })

    it("reverts when accept expiration timestamp of zero is provided", async () => {
      const { marketplace, sponsor } = await deployMarketplace()

      const acceptExpirationTimestamp = 0
      const offerData = ethers.utils.toUtf8Bytes("Some data here")

      await expect(marketplace.createOffer(123, acceptExpirationTimestamp, offerData)).to.be.revertedWithCustomError(
        marketplace,
        "AcceptExpirationTimestampMissing"
      )
    })

    it("reverts when accept expiration timestamp is in the past", async () => {
      const { marketplace, sponsor } = await deployMarketplace()

      const acceptExpirationTimestamp = (await ethers.provider.getBlock("latest")).timestamp - 1
      const offerData = ethers.utils.toUtf8Bytes("Some data here")

      await expect(marketplace.createOffer(123, acceptExpirationTimestamp, offerData)).to.be.revertedWithCustomError(
        marketplace,
        "AcceptExpirationTimestampInPast"
      )
    })

    it("reverts when no offer data provided", async () => {
      const { marketplace, sponsor } = await deployMarketplace()

      const acceptExpirationTimestamp = (await ethers.provider.getBlock("latest")).timestamp + 123
      const offerData = "0x"

      await expect(marketplace.createOffer(123, acceptExpirationTimestamp, offerData)).to.be.revertedWithCustomError(
        marketplace,
        "OfferDataMissing"
      )
    })

    xit("reverts when payment amount not provided", async () => {
      // const { marketplace, sponsor } = await deployMarketplace();
      // const acceptExpirationTimestamp = (await ethers.provider.getBlock("latest")).timestamp + 123;
      // const offerData = ethers.utils.toUtf8Bytes("Some data here");
      // await expect(marketplace.createOffer(123, acceptExpirationTimestamp, offerData)).to.be.revertedWithCustomError(
      //   marketplace,
      //   "OfferDataMissing"
      // );
    })

    it("Creates the offer", async () => {
      // Expectations:
      // - Tableland receives write event with the data
      // - Offer created event gets emitted
    })
  })
})
