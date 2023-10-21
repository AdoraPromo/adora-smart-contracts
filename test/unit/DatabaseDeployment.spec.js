const { ethers } = require("hardhat")
const { expect } = require("chai")
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs")

const { BigNumber } = ethers

const { decodeResult } = require("@chainlink/functions-toolkit")
const { setupFunctionsTestnet } = require("../utils/utils")

describe("Database deployment", () => {
  let addConsumerContractToSubscription
  let functionsRouterContract
  let donId

  before(async () => {
    const setup = await setupFunctionsTestnet()

    functionsRouterContract = setup.functionsRouterContract
    addConsumerContractToSubscription = setup.addConsumerContractToSubscription
    donId = setup.donId
  })

  it("mints the deals table", async () => {
    // NOTE: Registry address locally
    //       https://docs.tableland.xyz/smart-contracts/deployed-contracts#registry-contract
    const LOCAL_TABLELAND_REGISTRY = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512"

    const tablelandRegistry = await ethers.getContractAt("ITablelandTables", LOCAL_TABLELAND_REGISTRY)

    const Database = await ethers.getContractFactory("Database")
    const database = await Database.deploy({ gasLimit: 2000000 })
    await database.deployed()

    const deployTx = await database.deployTransaction.wait()

    // TODO: for some reason hre.network.config is empty
    const chainId = 31337

    // - id (text) - primary key
    // - status (text)
    // - sponsor_address (text)
    // - creator_address (text)
    // - terms_hash (text)
    // - encrypted_symmetric_key (text)
    // - encrypted_terms (text)
    // - redemption_expiration (integer)
    // - max_payment (text)
    // - redeemed_amount (text)
    // - encrypted_tweet_id (text)
    const dealsColumns =
      "id text primary key, " +
      "status text, " +
      "sponsor_address text, " +
      "creator_address text, " +
      "terms_hash text, " +
      "encrypted_symmetric_key text, " +
      "encrypted_terms text, " +
      "redemption_expiration integer, " +
      "max_payment text, " +
      "redeemed_amount text, " +
      "encrypted_tweet_id text"

    const TRANSFER_EVENT_SIGNATURE = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")
    )

    const transferLogs = deployTx.logs.filter(
      (log) =>
        log.topics[0] === TRANSFER_EVENT_SIGNATURE &&
        BigNumber.from(log.topics[1]).toString() === "0" && // from address(0)
        log.topics[2].slice(-40).toLowerCase() === database.address.slice(-40).toLowerCase() // to database.address
    )

    expect(transferLogs.length).to.eq(1)

    await expect(database.deployTransaction)
      .to.emit(tablelandRegistry, "CreateTable")
      .withArgs(database.address, anyValue, `CREATE TABLE deals_${chainId}(${dealsColumns});`)

    expect(await database.s_tableId).not.to.eq(0)
    expect(await database.s_tableName).not.to.eq("")
  })
})
