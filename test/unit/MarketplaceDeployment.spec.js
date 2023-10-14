const { ethers } = require("hardhat")
const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")

const { BigNumber } = ethers

describe("Marketplace deployment", () => {
  it("reverts if payment token address is zero", async () => {
    const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")

    await expect(Marketplace.deploy(ethers.constants.AddressZero, { gasLimit: 2000000 })).to.be.revertedWithCustomError(
      Marketplace,
      "PaymentTokenMissing"
    )
  })

  it("mints the deals and users tables", async () => {
    const Marketplace = await ethers.getContractFactory("SponsorshipMarketplace")

    // NOTE: Registry address locally
    //       https://docs.tableland.xyz/smart-contracts/deployed-contracts#registry-contract
    const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"

    const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)
    const ApeCoin = await ethers.getContractFactory("ApeCoin")
    const apeCoin = await ApeCoin.deploy("ApeCoin", "APE", 100)

    const marketplace = await Marketplace.deploy(apeCoin.address, { gasLimit: 2000000 })
    await marketplace.deployed()

    const deployTx = await marketplace.deployTransaction.wait()

    // TODO: for some reason hre.network.config is empty
    const chainId = 31337

    const dealsColumns =
      "id text primary key, " +
      "creator_id text, " +
      "sponsor_id text, " +
      "status text, " +
      "max_payment_amount text, " +
      "payment_per_like text, " +
      "payment_token text, " +
      "tweet_id text, " +
      "requirements text, " +
      "created_at integer, " +
      "delivery_deadline integer, " +
      "delivery_attempts integer"

    const usersColumns = "id text primary key, " + "twitter_account_id text, " + "address text"

    const TRANSFER_EVENT_SIGNATURE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")
    )

    ;[0, 1].forEach(() => {
      const logs = deployTx.logs.filter(
        (log) =>
          log.topics[0] === TRANSFER_EVENT_SIGNATURE &&
          BigNumber.from(log.topics[1]).toString() === "0" &&
          log.topics[2].slice(-40).toLowerCase() === marketplace.address.slice(-40).toLowerCase()
      )

      expect(logs.length).to.eq(2)
    })

    await expect(marketplace.deployTransaction)
      .to.emit(tablelandRegistry, "CreateTable")
      .withArgs(marketplace.address, anyValue, `CREATE TABLE deals_${chainId}(${dealsColumns});`)
      .and.to.emit(tablelandRegistry, "CreateTable")
      .withArgs(marketplace.address, anyValue, `CREATE TABLE users_${chainId}(${usersColumns});`)
  })
})
