// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/FunctionsClient.sol";
// import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
// import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/libraries/FunctionsRequest.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@tableland/evm/contracts/utils/TablelandDeployments.sol";
import "@tableland/evm/contracts/utils/SQLHelpers.sol";

import {ApeCoin} from "./ApeCoin.sol";

contract SponsorshipMarketplace is ERC721Holder {
  // is FunctionsClient, ConfirmedOwner {

  enum Status {
    NEW,
    ACCEPTED,
    REDEEMED,
    WITHDRAWN
  }

  struct Deal {
    Status status;
    address sponsor;
    address creator;
    bytes32 termsHash;
    // Encrypted using Chainlink Functions publicEncryptionKey
    string encryptedSymmetricKey;
    // Encrypted using symmetricKey
    string encryptedTerms;
    uint256 redemptionExpiration;
    uint256 maxPayment;
    string encryptedTweetId;
  }

  using Strings for uint256;

  ApeCoin public s_paymentToken;

  uint256 public s_tableId;
  string public s_tableName;

  mapping(bytes32 id => Deal deal) private s_deals;

  error PaymentTokenMissing();
  error MaxValueAllowanceMissing();
  error DealAlreadyExists();
  error RedemptionExpirationMustBeInFuture();
  error TermsHashMissing();
  error EncryptedSymmetricKeyMissing();
  error EncryptedTermsMissing();
  error MaxPaymentMissing();

  event DealCreated(bytes32 dealId);

  constructor(address paymentToken) {
    _requirePaymentToken(paymentToken);

    s_paymentToken = ApeCoin(paymentToken);

    (uint256 tableId, string memory tableName) = _createTable(
      "deals",
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
      "encrypted_tweet_id text"
    );

    s_tableId = tableId;
    s_tableName = tableName;
  }

  function _requirePaymentToken(address paymentToken) internal pure {
    if (paymentToken == address(0)) {
      revert PaymentTokenMissing();
    }
  }

  function createDeal(
    bytes32 termsHash,
    string calldata encryptedSymmetricKey,
    string calldata encryptedTerms,
    uint256 maxPayment,
    uint256 redemptionExpiration
  ) external returns (bytes32 dealId) {
    _runCreateDealValidations(termsHash, encryptedSymmetricKey, encryptedTerms, maxPayment, redemptionExpiration);

    _requireMarketplacePaymentTokenAllowance(maxPayment);

    Deal memory deal = Deal(
      Status.NEW,
      msg.sender,
      address(0),
      termsHash,
      encryptedSymmetricKey,
      encryptedTerms,
      redemptionExpiration,
      maxPayment,
      ""
    );

    dealId = keccak256(abi.encode(deal));
    _requireDealDoesNotExist(dealId);

    s_deals[dealId] = deal;

    TablelandDeployments.get().mutate(address(this), s_tableId, _dealInsertSql(dealId, deal));

    emit DealCreated(dealId);
  }

  // TODO: use proper smart contract member organization in this file
  //       (external/public, internal, internal view, internal pure functions order + other ordering)
  function _createTable(
    string memory prefix,
    string memory columns
  ) internal returns (uint256 tableId, string memory tableName) {
    string memory schema = string.concat(SQLHelpers.toCreateFromSchema(columns, prefix), ";");
    string memory chainId = Strings.toString(block.chainid);

    tableId = TablelandDeployments.get().create(address(this), schema);
    tableName = string.concat(prefix, "_", chainId, "_", Strings.toString(tableId));
  }

  function _runCreateDealValidations(
    bytes32 termsHash,
    string calldata encryptedSymmetricKey,
    string calldata encryptedTerms,
    uint256 maxPayment,
    uint256 redemptionExpiration
  ) internal view {
    _requireTermsHash(termsHash);

    _requireEncryptedSymmetricKey(encryptedSymmetricKey);

    _requireEncryptedTerms(encryptedTerms);

    _requireMaxPayment(maxPayment);

    _requireRedemptionExpirationInFuture(redemptionExpiration);
  }

  // "deals",
  //   "id text primary key, "
  //   "status text, "
  //   "sponsor_address text, "
  //   "creator_address text, "
  //   "terms_hash text, "
  //   "encrypted_symmetric_key text, "
  //   "encrypted_terms text, "
  //   "redemption_expiration integer, "
  //   "max_payment text, "
  //   "redeemed_amount text, "
  //   "encrypted_tweet_id text"
  function _dealInsertSql(bytes32 dealId, Deal memory deal) internal view returns (string memory) {
    string memory columns = "id,"
    "status,"
    "sponsor_address,"
    "creator_address,"
    "terms_hash,"
    "encrypted_symmetric_key,"
    "encrypted_terms,"
    "redemption_expiration,"
    "max_payment";

    return SQLHelpers.toInsert("deals", s_tableId, columns, _dealInsertSqlValues(dealId, deal));
  }

  function _requireMarketplacePaymentTokenAllowance(uint256 maxPayment) internal view {
    uint256 allowance = s_paymentToken.allowance(msg.sender, address(this));

    if (allowance < maxPayment) {
      revert MaxValueAllowanceMissing();
    }
  }

  function _requireDealDoesNotExist(bytes32 dealId) internal view {
    if (s_deals[dealId].sponsor != address(0)) {
      revert DealAlreadyExists();
    }
  }

  function _requireRedemptionExpirationInFuture(uint256 redemptionExpiration) internal view {
    if (redemptionExpiration <= block.timestamp) {
      revert RedemptionExpirationMustBeInFuture();
    }
  }

  //   "deals"
  //     "id,"
  //     "status,"
  //     "sponsor_address,"
  //     "creator_address,"
  //     "terms_hash,"
  //     "encrypted_symmetric_key,"
  //     "encrypted_terms,"
  //     "redemption_expiration,"
  //     "max_payment,"
  function _dealInsertSqlValues(bytes32 dealId, Deal memory deal) internal pure returns (string memory) {
    return
      string.concat(
        SQLHelpers.quote(Base64.encode(abi.encodePacked(dealId))),
        // The status is hardcoded as new
        ",'NEW',",
        SQLHelpers.quote(Strings.toHexString(uint160(deal.sponsor))),
        ",",
        SQLHelpers.quote(Strings.toHexString(uint160(deal.creator))),
        ",",
        SQLHelpers.quote(Base64.encode(abi.encodePacked(deal.termsHash))),
        ",",
        SQLHelpers.quote(deal.encryptedSymmetricKey),
        ",",
        SQLHelpers.quote(deal.encryptedTerms),
        ",",
        deal.redemptionExpiration.toString(),
        ",",
        SQLHelpers.quote(Strings.toHexString(deal.maxPayment))
      );
  }

  function _requireTermsHash(bytes32 termsHash) internal pure {
    if (termsHash == bytes32(0)) {
      revert TermsHashMissing();
    }
  }

  function _requireEncryptedSymmetricKey(string calldata encryptedSymmetricKey) internal pure {
    if (bytes(encryptedSymmetricKey).length == 0) {
      revert EncryptedSymmetricKeyMissing();
    }
  }

  function _requireEncryptedTerms(string calldata encryptedTerms) internal pure {
    if (bytes(encryptedTerms).length == 0) {
      revert EncryptedTermsMissing();
    }
  }

  function _requireMaxPayment(uint256 maxPayment) internal pure {
    if (maxPayment == 0) {
      revert MaxPaymentMissing();
    }
  }
}
