const { networks } = require("../networks")
const { SecretsManager, SubscriptionManager, createGist } = require("@chainlink/functions-toolkit")
const fs = require("fs")
const path = require("path")

task("adora-set-source", "Sets Functions source code on SponsorshipMarketplace contract").setAction(async () => {
  console.log(`Connecting to SponsorshipMarketplace contract`)
  const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")
  const marketplace = await Marketplace.attach("0xd4F8AB799471CA08E571bfA6CE26d51a952CD504")
  console.log(`Setting source code`)
  const acceptSource = fs.readFileSync(path.join(__dirname, "..", "acceptanceVerification.js"), "utf8")
  const redeemSource = fs.readFileSync(path.join(__dirname, "..", "redemption.js"), "utf8")
  const setAcceptSourceTxReceipt = await (
    await marketplace.setAcceptFunctionSource(acceptSource, { gasLimit: 10000000, nonce: 181, gasPrice: 100000000000 })
  ).wait()
  //await (await marketplace.setRedeemFunctionSource(redeemSource, { gasLimit: 10000000 })).wait()
  console.log(`Set Functions source code`)
})
