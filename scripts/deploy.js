// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
const fs = require("fs")
const path = require("path")

const { network, run } = require("hardhat")

const { developmentChains } = require("../networks.js")

const deployDatabase = async (deployer, chainId) => {
  const Database = await ethers.getContractFactory("Database")
  const database = await Database.connect(deployer).deploy()
  await database.deployed()

  console.log(`Database deployed to ${database.address} on ${network.name}`)

  if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
    await run("verify:verify", {
      address: database.address,
      constructorArguments: [],
    })
  }

  return database.address
}

const deployMarketplace = async (deployer, databaseAddress, chainId) => {
  const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
  console.log(
    process.env.FUNCTIONS_ROUTER_ADDRESS,
    ethers.utils.formatBytes32String(process.env.DON_ID),
    process.env.APE_COIN_ADDRESS,
    databaseAddress
  )
  const marketplace = await Marketplace.connect(deployer).deploy(
    process.env.FUNCTIONS_ROUTER_ADDRESS,
    ethers.utils.formatBytes32String(process.env.DON_ID),
    process.env.APE_COIN_ADDRESS,
    databaseAddress,
    { gasLimit: 30000000 }
  )
  await marketplace.deployed()

  const acceptSource = fs.readFileSync(path.join(__dirname, "..", "acceptanceVerification.js"), "utf8")

  const redeemSource = fs.readFileSync(path.join(__dirname, "..", "redemption.js"), "utf8")

  const subscriptionId = process.env.SUBSCRIPTION_ID

  await (await marketplace.setAcceptFunctionSource(acceptSource)).wait()
  await (await marketplace.setRedeemFunctionSource(redeemSource)).wait()
  await (await marketplace.setSubscriptionId(subscriptionId)).wait()

  console.log(`Marketplace deployed to ${marketplace.address} on ${network.name}`)

  if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
    await run("verify:verify", {
      address: marketplace.address,
      constructorArguments: [
        process.env.FUNCTIONS_ROUTER_ADDRESS,
        ethers.utils.formatBytes32String(process.env.DON_ID),
        process.env.APE_COIN_ADDRESS,
        databaseAddress,
      ],
    })
  }
}

async function main() {
  await run("compile")
  const chainId = network.config.chainId

  //set log level to ignore non errors
  ethers.utils.Logger.setLogLevel(ethers.utils.Logger.levels.ERROR)

  const accounts = await ethers.getSigners()
  const deployer = accounts[0]

  const databaseAddress = await deployDatabase(deployer, chainId)
  await deployMarketplace(deployer, databaseAddress, chainId)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
