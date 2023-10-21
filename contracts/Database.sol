// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {TablelandDeployments} from "@tableland/evm/contracts/utils/TablelandDeployments.sol";
import {SQLHelpers} from "@tableland/evm/contracts/utils/SQLHelpers.sol";
import {SponsorshipMarketplace} from "./SponsorshipMarketplace.sol";

contract Database is ERC721Holder, ConfirmedOwner {
  using Strings for uint256;

  uint256 public s_tableId;
  string public s_tableName;
  address private s_writer;

  error NotAllowed();

  constructor() ConfirmedOwner(msg.sender) {
    string memory schema = string.concat(
      SQLHelpers.toCreateFromSchema(
        // NOTE: these are the columns
        "id text primary key, "
        "status text, "
        "sponsor_address text, "
        "creator_address text, "
        "terms_hash text, "
        "encrypted_symmetric_key text, "
        "encrypted_terms text, "
        "redemption_expiration integer, "
        "max_payment text, "
        "redeemed_amount text, "
        "encrypted_tweet_id text",
        // NOTE: this is the prefix
        "deals"
      ),
      ";"
    );
    string memory chainId = Strings.toString(block.chainid);

    s_tableId = TablelandDeployments.get().create(address(this), schema);
    s_tableName = string.concat("deals_", chainId, "_", Strings.toString(s_tableId));
  }

  modifier onlyWriter() {
    if (msg.sender != s_writer) {
      revert NotAllowed();
    }
    _;
  }

  function setWriter(address writer) external onlyOwner {
    s_writer = writer;
  }

  function insertDeal(bytes32 dealId, SponsorshipMarketplace.Deal calldata deal) external onlyWriter returns (bool) {
    TablelandDeployments.get().mutate(
      address(this),
      s_tableId,
      SQLHelpers.toInsert(
        "deals",
        s_tableId,
        // NOTE: these are the columns
        "id,"
        "status,"
        "sponsor_address,"
        "creator_address,"
        "terms_hash,"
        "encrypted_symmetric_key,"
        "encrypted_terms,"
        "redemption_expiration,"
        "max_payment",
        _dealInsertSqlValues(dealId, deal)
      )
    );

    return true;
  }

  function updateDeal(bytes32 dealId, string calldata setter) external onlyWriter returns (bool) {
    TablelandDeployments.get().mutate(
      address(this),
      s_tableId,
      SQLHelpers.toUpdate(
        "deals",
        s_tableId,
        setter,
        string.concat("id='", Base64.encode(abi.encodePacked(dealId)), "'")
      )
    );

    return true;
  }

  function _dealInsertSqlValues(
    bytes32 dealId,
    SponsorshipMarketplace.Deal memory deal
  ) internal pure returns (string memory) {
    return
      string.concat(
        "'",
        Base64.encode(abi.encodePacked(dealId)),
        // The status is hardcoded as new
        "','New','",
        Strings.toHexString(uint160(deal.sponsor)),
        "','",
        Strings.toHexString(uint160(deal.creator)),
        "','",
        Base64.encode(abi.encodePacked(deal.termsHash)),
        "','",
        deal.encryptedSymmetricKey,
        "','",
        deal.encryptedTerms,
        "',",
        deal.redemptionExpiration.toString(),
        ",'",
        Strings.toHexString(deal.maxPayment),
        "'"
      );
  }
}
