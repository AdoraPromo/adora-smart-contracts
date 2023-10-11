const { expect } = require("chai")
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")

describe("Sponsorship Marketplace", async function () {
  const deployMarketplace = async () => {
    const [owner, sponsor, creator] = await ethers.getSigners()

    const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
    const marketplace = await Marketplace.deploy()

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
    it("mints the offers table", async () => {})
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

    it("Creates the offer", async () => {
      // Expectations:
      // - Tableland receives write event with the data
      // - Offer created event gets emitted
    })
  })
})
