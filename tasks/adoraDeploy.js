const { networks } = require("../networks")
const { SecretsManager, SubscriptionManager, createGist } = require("@chainlink/functions-toolkit")
const fs = require("fs")
const path = require("path")

task("adora-deploy", "Deploys the Adora.Promo contracts").setAction(async () => {
  let nonce = 38
  let gasPrice = 100000000000

  console.log("\n__Compiling Contracts__")
  await run("compile")

  console.log(`Deploying Database contract`)
  const Database = await ethers.getContractFactory("Database")
  const database = await Database.deploy({ gasLimit: 10000000, gasPrice, nonce })
  nonce++
  await database.deployTransaction.wait(10)
  console.log(`Database contract deployed to ${database.address}`)
  console.log("\nVerifying Database contract...")
  try {
    await run("verify:verify", {
      address: database.address,
      constructorArguments: [],
    })
  } catch (error) {
    if (!error.message.includes("Already Verified")) {
      console.log(
        "Error verifying contract. Ensure you are waiting for enough confirmation blocks, delete the build folder and try again."
      )
      console.log(error)
    } else {
      console.log("Contract already verified")
    }
  }
  console.log("Database contract verified")

  console.log(`Deploying SponsorshipMarketplace contract`)
  const apeCoinAddress = "0xB7b31a6BC18e48888545CE79e83E06003bE70930"
  const functionsRouterAddress = networks[network.name]["functionsRouter"]
  const donIdBytes32 = hre.ethers.utils.formatBytes32String(networks[network.name]["donId"])
  const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
  const marketplace = await Marketplace.deploy(functionsRouterAddress, donIdBytes32, apeCoinAddress, database.address, {
    gasLimit: 10000000,
    gasPrice,
    nonce,
  })
  nonce++
  await marketplace.deployTransaction.wait(10)
  console.log(`SponsorshipMarketplace contract deployed to ${marketplace.address}`)
  console.log("\nVerifying SponsorshipMarketplace contract...")
  try {
    await run("verify:verify", {
      address: marketplace.address,
      constructorArguments: [functionsRouterAddress, donIdBytes32, apeCoinAddress, database.address],
    })
  } catch (error) {
    if (!error.message.includes("Already Verified")) {
      console.log(
        "Error verifying contract. Ensure you are waiting for enough confirmation blocks, delete the build folder and try again."
      )
      console.log(error)
    } else {
      console.log("Contract already verified")
    }
  }
  console.log("SponsorshipMarketplace contract verified")
  await (await database.setWriter(marketplace.address, { gasLimit: 10000000, gasPrice, nonce })).wait()
  nonce++

  const subscriptionId = 21
  const signer = await ethers.getSigner()
  const linkTokenAddress = networks[network.name]["linkToken"]
  const subManager = new SubscriptionManager({ signer, linkTokenAddress, functionsRouterAddress })
  await subManager.initialize()
  await subManager.addConsumer({
    subscriptionId,
    consumerAddress: marketplace.address,
    txOptions: { overrides: { gasLimit: 10000000, gasPrice, nonce } },
  })
  nonce++
  console.log(`Added consumer ${marketplace.address} to subscription ${subscriptionId}`)

  const acceptSource = fs.readFileSync(path.join(__dirname, "..", "acceptanceVerification.js"), "utf8")
  const redeemSource = fs.readFileSync(path.join(__dirname, "..", "redemption.js"), "utf8")
  await (await marketplace.setAcceptFunctionSource(acceptSource, { gasLimit: 10000000, gasPrice, nonce })).wait()
  nonce++
  await (await marketplace.setRedeemFunctionSource(redeemSource, { gasLimit: 10000000, gasPrice, nonce })).wait()
  nonce++
  await (await marketplace.setSubscriptionId(subscriptionId, { gasLimit: 10000000, gasPrice, nonce })).wait()
  nonce++
  console.log(`Set marketplace contract sources and subscription ID`)

  const secrets = {
    twitterApiKey: process.env.TWITTER_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
    privateDecryptionKeyBase64: process.env.PRIVATE_DECRYPTION_KEY_BASE64,
  }

  const donId = networks[network.name]["donId"]
  const secretsManager = new SecretsManager({ signer, functionsRouterAddress, donId })
  await secretsManager.initialize()
  const encryptedSecrets = await secretsManager.encryptSecrets(secrets)
  const gistUrl = await createGist(process.env["GITHUB_API_TOKEN"], JSON.stringify(encryptedSecrets))
  const encryptedSecretsReference = await secretsManager.encryptSecretsUrls([gistUrl])
  await (
    await marketplace.setEncryptedSecretsReference(encryptedSecretsReference, { gasLimit: 10000000, gasPrice, nonce })
  ).wait()
  console.log(`Set marketplace contract encrypted secrets reference`)
  console.log(`Nonce: ${nonce}`)
})
