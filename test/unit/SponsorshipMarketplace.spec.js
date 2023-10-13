const { ethers } = require("hardhat")
const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")

const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers")

const { decodeResult } = require("@chainlink/functions-toolkit")

const { BigNumber } = ethers

// The setupFunctionsTestnet async function will deploy all the required Chainlink Functions contracts to the HardHat test network.
// It will return the FunctionsRouter contract to which Functions requests can be sent.
// It will also simulate execution and fulfillment of Functions requests send to this FunctionsRouter contract.
// It will automatically create subscription ID 1 and fund it with 1,000 LINK to pay for Functions requests.
// It will also return a helper function called `addConsumerContractToSubscription` used to authorize a deployed contract to use the subscription.
// addConsumerContractToSubscription is an async function that takes a single contract address as input and adds it to the Functions subscription.
const { setupFunctionsTestnet } = require("../utils/utils")

describe("Sponsorship Marketplace", () => {
  let functionsRouterContract
  let addConsumerContractToSubscription

  before(async () => {
    const setup = await setupFunctionsTestnet()
    functionsRouterContract = setup.functionsRouterContract
    addConsumerContractToSubscription = setup.addConsumerContractToSubscription
  })

  // The code below only exists to test that setupFunctionsTestnet works as expected. (Feel free to remove it.)
  describe("Test Functions Testnet", () => {
    it("Executes and fulfills a request", async () => {
      const functionsConsumerFactory = await ethers.getContractFactory("FunctionsConsumer")
      const functionsConsumer = await functionsConsumerFactory.deploy(
        functionsRouterContract.address,
        "0x66756e2d706f6c79676f6e2d6d756d6261692d31000000000000000000000000"
      )
      await addConsumerContractToSubscription(functionsConsumer.address)

      const requestTx = await functionsConsumer.sendRequest(
        "return Functions.encodeUint256(100)", // JavaScript source code
        1, // Secrets location
        [], // encryptedSecretsReference
        [], // args
        [], // bytesArgs
        1, // subscriptionId
        300_000 // callbackGasLimit
      )
      const requestReceipt = await requestTx.wait()
      const requestId = requestReceipt.events[2].args.id

      const listenForResponse = new Promise((resolve) => {
        functionsRouterContract.on(
          "RequestProcessed",
          (_requestId, subscriptionId, totalCostJuels, _, resultCode, response, err, returnData) => {
            if (requestId === _requestId) {
              functionsRouterContract.removeAllListeners("RequestProcessed")
              resolve({
                requestId,
                subscriptionId: Number(subscriptionId.toString()),
                totalCostInJuels: BigInt(totalCostJuels.toString()),
                responseBytesHexstring: response,
                errorString: Buffer.from(err.slice(2), "hex").toString(),
                returnDataBytesHexstring: returnData,
                fulfillmentCode: resultCode,
              })
            }
          }
        )
      })

      const { responseBytesHexstring } = await listenForResponse
      const result = decodeResult(responseBytesHexstring, "uint256")
      expect(result).to.equal(100)
    })
  })

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

  describe.only("Deployment", () => {
    it("reverts if payment token address is zero", async () => {
      const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")

      await expect(Marketplace.deploy("0x", { gasLimit: 2000000 })).to.be.revertedWithCustomError(
        marketplace,
        "PaymentTokenNotProvided"
      )
    })

    it("mints the deals and users tables", async () => {
      const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
      const [randomAccount] = await ethers.getSigners()

      // NOTE: Registry address locally
      //       https://docs.tableland.xyz/smart-contracts/deployed-contracts#registry-contract
      const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"

      const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)

      const marketplace = await Marketplace.deploy(randomAccount, { gasLimit: 2000000 })
      await marketplace.deployed()
      const deployTx = await marketplace.deployTransaction.wait()

      // TODO: for some reason hre.network.config is empty
      const chainId = 31337

      const dealsColumns =
        "id text primary key, " +
        "creator_id text, " +
        "sponsor_id text, " +
        "status text, " +
        "payment_amount text, " +
        "payment_token text, " +
        "tweet_id text, " +
        "requirements text, " +
        "created_at integer, " +
        "delivery_deadline integer"

      const usersColumns = "id text primary key, " + "twitter_account_id text, " + "address text"

      const TRANSFER_EVENT_SIGNATURE = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")
      )

      // NOTE: tableland mints first table (id=1) for the healthbot
      ;[2, 3].forEach((tableId) => {
        const transferLog = deployTx.logs.find(
          (log) =>
            log.topics[0] === TRANSFER_EVENT_SIGNATURE &&
            BigNumber.from(log.topics[1]).toString() === "0" &&
            log.topics[2].slice(-40).toLowerCase() === marketplace.address.slice(-40).toLowerCase() &&
            BigNumber.from(log.topics[3]).toString() === tableId.toString()
        )

        expect(transferLog).to.not.be.undefined
      })

      await expect(marketplace.deployTransaction)
        .to.emit(tablelandRegistry, "CreateTable")
        .withArgs(marketplace.address, 2, `CREATE TABLE deals_${chainId}(${dealsColumns});`)
        .and.to.emit(tablelandRegistry, "CreateTable")
        .withArgs(marketplace.address, 3, `CREATE TABLE users_${chainId}(${usersColumns});`)
    })
  })

  describe("Offer creation", () => {
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
