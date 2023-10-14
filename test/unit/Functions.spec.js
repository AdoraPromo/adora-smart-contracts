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
})
