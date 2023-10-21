const { ethers } = require("hardhat")
const { simulateScript } = require("@chainlink/functions-toolkit")
const cbor = require("cbor")
const {
  LinkTokenSource,
  MockV3AggregatorSource,
  FunctionsRouterSource,
  FunctionsCoordinatorTestHelperSource,
  TermsOfServiceAllowListSource,
} = require("./functions_contract_sources")
const {
  simulatedRouterConfig,
  simulatedCoordinatorConfig,
  simulatedAllowListConfig,
  simulatedDonId,
  simulatedAllowListId,
  simulatedLinkEthPrice,
  callReportGasLimit,
  simulatedSecretsKeys,
  DEFAULT_MAX_ON_CHAIN_RESPONSE_BYTES,
  numberOfSimulatedNodeExecutions,
} = require("./simulationConfig")

const setupFunctionsTestnet = async () => {
  const [owner] = await ethers.getSigners()
  const { linkTokenContract, functionsRouterContract, functionsMockCoordinatorContract, donId } =
    await deployFunctionsOracleContracts(owner)

  functionsMockCoordinatorContract.on(
    "OracleRequest",
    (
      requestId,
      requestingContract,
      requestInitiator,
      subscriptionId,
      subscriptionOwner,
      data,
      dataVersion,
      flags,
      callbackGasLimit,
      commitment
    ) => {
      const requestEvent = {
        requestId,
        requestingContract,
        requestInitiator,
        subscriptionId,
        subscriptionOwner,
        data,
        dataVersion,
        flags,
        callbackGasLimit,
        commitment,
      }
      handleOracleRequest(
        requestEvent,
        functionsMockCoordinatorContract,
        owner,
        `${__dirname}/../../Functions-request-config.js`
      )
    }
  )

  const createSubTx = await functionsRouterContract.connect(owner).createSubscription()
  await createSubTx.wait()
  const fundSubTx = await linkTokenContract
    .connect(owner)
    .transferAndCall(
      functionsRouterContract.address,
      BigInt("1000000000000000000000"),
      ethers.utils.defaultAbiCoder.encode(["uint64"], [1])
    )
  await createSubTx.wait()

  const addConsumerContractToSubscription = async (consumerContractAddress) => {
    const addConsumerTx = await functionsRouterContract.addConsumer(1, consumerContractAddress)
    await addConsumerTx.wait()
  }

  return {
    donId,
    functionsRouterContract,
    addConsumerContractToSubscription,
  }
}

const deployFunctionsOracleContracts = async (deployer) => {
  const linkTokenFactory = new ethers.ContractFactory(LinkTokenSource.abi, LinkTokenSource.bytecode, deployer)
  const linkToken = await linkTokenFactory.connect(deployer).deploy()

  const linkPriceFeedFactory = new ethers.ContractFactory(
    MockV3AggregatorSource.abi,
    MockV3AggregatorSource.bytecode,
    deployer
  )
  const linkPriceFeed = await linkPriceFeedFactory.connect(deployer).deploy(18, simulatedLinkEthPrice)

  const routerFactory = new ethers.ContractFactory(FunctionsRouterSource.abi, FunctionsRouterSource.bytecode, deployer)
  const router = await routerFactory.connect(deployer).deploy(linkToken.address, simulatedRouterConfig)

  const mockCoordinatorFactory = new ethers.ContractFactory(
    FunctionsCoordinatorTestHelperSource.abi,
    FunctionsCoordinatorTestHelperSource.bytecode,
    deployer
  )
  const mockCoordinator = await mockCoordinatorFactory
    .connect(deployer)
    .deploy(router.address, simulatedCoordinatorConfig, linkPriceFeed.address)

  const allowlistFactory = new ethers.ContractFactory(
    TermsOfServiceAllowListSource.abi,
    TermsOfServiceAllowListSource.bytecode,
    deployer
  )
  const allowlist = await allowlistFactory.connect(deployer).deploy(simulatedAllowListConfig)

  const setAllowListIdTx = await router.setAllowListId(ethers.utils.formatBytes32String(simulatedAllowListId))
  await setAllowListIdTx.wait(1)

  const allowlistId = await router.getAllowListId()
  const proposeContractsTx = await router.proposeContractsUpdate(
    [allowlistId, ethers.utils.formatBytes32String(simulatedDonId)],
    [allowlist.address, mockCoordinator.address],
    {
      gasLimit: 1_000_000,
    }
  )
  await proposeContractsTx.wait(1)
  await router.updateContracts({ gasLimit: 1_000_000 })

  await mockCoordinator.connect(deployer).setDONPublicKey(simulatedSecretsKeys.donKey.publicKey)
  await mockCoordinator
    .connect(deployer)
    .setThresholdPublicKey("0x" + Buffer.from(simulatedSecretsKeys.thresholdKeys.publicKey).toString("hex"))

  return {
    donId: simulatedDonId,
    linkTokenContract: linkToken,
    functionsRouterContract: router,
    functionsMockCoordinatorContract: mockCoordinator,
  }
}

const handleOracleRequest = async (requestEventData, mockCoordinator, admin, simulationConfigPath) => {
  const response = await simulateDONExecution(requestEventData, simulationConfigPath)
  const errorHexstring = response.errorString
    ? "0x" + Buffer.from(response.errorString.toString()).toString("hex")
    : undefined
  const encodedReport = encodeReport(
    requestEventData.requestId,
    requestEventData.commitment,
    response.responseBytesHexstring,
    errorHexstring
  )

  const reportTx = await mockCoordinator.connect(admin).callReport(encodedReport, { gasLimit: callReportGasLimit })
  await reportTx.wait(1)
}

const simulateDONExecution = async (requestEventData, simulationConfigPath) => {
  let requestData
  try {
    requestData = await buildRequestObject(requestEventData.data)
  } catch {
    return {
      errorString: "CBOR parsing error",
    }
  }

  const simulationConfig = simulationConfigPath ? require(simulationConfigPath) : {}
  // Perform the simulation numberOfSimulatedNodeExecution times
  const simulations = [...Array(numberOfSimulatedNodeExecutions)].map(async () => {
    try {
      return await simulateScript({
        source: requestData.source,
        secrets: simulationConfig.secrets, // Secrets are taken from simulationConfig, not request data included in transaction
        args: requestData.args,
        bytesArgs: requestData.bytesArgs,
        maxOnChainResponseBytes: simulationConfig.maxOnChainResponseBytes,
        maxExecutionTimeMs: simulationConfig.maxExecutionTimeMs,
        maxMemoryUsageMb: simulationConfig.maxMemoryUsageMb,
        numAllowedQueries: simulationConfig.numAllowedQueries,
        maxQueryDurationMs: simulationConfig.maxQueryDurationMs,
        maxQueryUrlLength: simulationConfig.maxQueryUrlLength,
        maxQueryRequestBytes: simulationConfig.maxQueryRequestBytes,
        maxQueryResponseBytes: simulationConfig.maxQueryResponseBytes,
      })
    } catch (err) {
      const errorString = err.message.slice(
        0,
        simulationConfig.maxOnChainResponseBytes ?? DEFAULT_MAX_ON_CHAIN_RESPONSE_BYTES
      )
      return {
        errorString,
        capturedTerminalOutput: "",
      }
    }
  })
  const responses = await Promise.all(simulations)

  const successfulResponses = responses.filter((response) => response.errorString === undefined)
  const errorResponses = responses.filter((response) => response.errorString !== undefined)

  if (successfulResponses.length > errorResponses.length) {
    return {
      responseBytesHexstring: aggregateMedian(successfulResponses.map((response) => response.responseBytesHexstring)),
    }
  } else {
    const errorString = aggregateModeString(errorResponses.map((response) => response.errorString))
    return {
      errorString,
    }
  }
}

const aggregateMedian = (responses) => {
  const bufResponses = responses.map((response) => Buffer.from(response.slice(2), "hex"))

  bufResponses.sort((a, b) => {
    if (a.length !== b.length) {
      return a.length - b.length
    }
    for (let i = 0; i < a.length; ++i) {
      if (a[i] !== b[i]) {
        return a[i] - b[i]
      }
    }
    return 0
  })

  return "0x" + bufResponses[Math.floor((bufResponses.length - 1) / 2)].toString("hex")
}

const aggregateModeString = (items) => {
  const counts = {}

  for (const str of items) {
    const existingCount = counts[str] || 0
    counts[str] = existingCount + 1
  }

  let modeString = items[0]
  let maxCount = counts[modeString] || 0

  for (const [str, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count
      modeString = str
    }
  }

  return modeString
}

const encodeReport = (requestId, commitment, result, error) => {
  const encodedCommitment = ethers.utils.defaultAbiCoder.encode(
    ["bytes32", "address", "uint96", "address", "uint64", "uint32", "uint72", "uint72", "uint40", "uint40", "uint32"],
    [
      commitment.requestId,
      commitment.coordinator,
      commitment.estimatedTotalCostJuels,
      commitment.client,
      commitment.subscriptionId,
      commitment.callbackGasLimit,
      commitment.adminFee,
      commitment.donFee,
      commitment.gasOverheadBeforeCallback,
      commitment.gasOverheadAfterCallback,
      commitment.timeoutTimestamp,
    ]
  )
  const encodedReport = ethers.utils.defaultAbiCoder.encode(
    ["bytes32[]", "bytes[]", "bytes[]", "bytes[]", "bytes[]"],
    [[requestId], [result ?? []], [error ?? []], [encodedCommitment], [[]]]
  )
  return encodedReport
}

const buildRequestObject = async (requestDataHexString) => {
  const decodedRequestData = await cbor.decodeAll(Buffer.from(requestDataHexString.slice(2), "hex"))

  if (typeof decodedRequestData[0] === "object") {
    if (decodedRequestData[0].bytesArgs) {
      decodedRequestData[0].bytesArgs = decodedRequestData[0].bytesArgs?.map((bytesArg) => {
        return "0x" + bytesArg?.toString("hex")
      })
    }
    decodedRequestData[0].secrets = undefined
    return decodedRequestData[0]
  }
  const requestDataObject = {}
  // The decoded request data is an array of alternating keys and values, therefore we can iterate over it in steps of 2
  for (let i = 0; i < decodedRequestData.length - 1; i += 2) {
    const requestDataKey = decodedRequestData[i]
    const requestDataValue = decodedRequestData[i + 1]
    switch (requestDataKey) {
      case "codeLocation":
        requestDataObject.codeLocation = requestDataValue
        break
      case "secretsLocation":
        // Unused as secrets provided as an argument to startLocalFunctionsTestnet() are used instead
        break
      case "language":
        requestDataObject.codeLanguage = requestDataValue
        break
      case "source":
        requestDataObject.source = requestDataValue
        break
      case "secrets":
        // Unused as secrets provided as an argument to startLocalFunctionsTestnet() are used instead
        break
      case "args":
        requestDataObject.args = requestDataValue
        break
      case "bytesArgs":
        requestDataObject.bytesArgs = requestDataValue?.map((bytesArg) => {
          return "0x" + bytesArg?.toString("hex")
        })
        break
      default:
      // Ignore unknown keys
    }
  }

  return requestDataObject
}

module.exports = {
  setupFunctionsTestnet,
}
