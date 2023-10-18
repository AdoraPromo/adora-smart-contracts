// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/FunctionsClient.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/libraries/FunctionsRequest.sol";

import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {TablelandDeployments} from "@tableland/evm/contracts/utils/TablelandDeployments.sol";
import {SQLHelpers} from "@tableland/evm/contracts/utils/SQLHelpers.sol";

import {ApeCoin} from "./ApeCoin.sol";
import {Database} from "./Database.sol";

contract SponsorshipMarketplace is ERC721Holder, FunctionsClient, ConfirmedOwner {
  using FunctionsRequest for FunctionsRequest.Request;

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

  ApeCoin private s_paymentToken;
  Database private s_database;

  bytes32 private s_donId;
  bytes private s_encryptedSecretsReference;
  uint64 private s_subscriptionId;

  string private s_acceptFunctionSource;
  // TODO: add this
  // string public redeemFunctionSource;

  mapping(bytes32 id => Deal deal) private s_deals;
  mapping(bytes32 requestId => bytes32 dealId) private s_acceptRequests;
  // TODO: add this
  // mapping(bytes32 requestId => bool submitted) private s_redeemRequests;

  error MaxValueAllowanceMissing();
  error DealAlreadyExists();
  error RedemptionExpirationMustBeInFuture();
  error TermsHashMissing();
  error EncryptedSymmetricKeyMissing();
  error EncryptedTermsMissing();
  error MaxPaymentMissing();
  error DealDoesNotExist();
  error AccountOwnershipProofMissing();
  error DealExpired();
  error DealStatusMustBeNew();

  event DealCreated(bytes32 dealId);
  event DealAccepted(bytes32 dealId);

  constructor(
    address routerAddress,
    bytes32 donId,
    address paymentToken,
    address database
  ) FunctionsClient(routerAddress) ConfirmedOwner(msg.sender) {
    s_paymentToken = ApeCoin(paymentToken);
    s_database = Database(database);
    s_donId = donId;
  }

  // TODO: test this
  function setDonId(bytes32 newDonId) external onlyOwner {
    s_donId = newDonId;
  }

  // TODO: test this
  function setAcceptFunctionSource(string calldata source) external {
    s_acceptFunctionSource = source;
  }

  // TODO: test this
  function setSubscriptionId(uint64 subscriptionId) external {
    s_subscriptionId = subscriptionId;
  }

  // TODO: test this
  function setEncryptedSecretsReference(bytes calldata secretsReference) external onlyOwner {
    s_encryptedSecretsReference = secretsReference;
  }

  function createDeal(
    bytes32 termsHash,
    string calldata encryptedSymmetricKey,
    string calldata encryptedTerms,
    uint256 maxPayment,
    uint256 redemptionExpiration
  ) external returns (bytes32 dealId) {
    if (termsHash == bytes32(0)) {
      revert TermsHashMissing();
    }

    if (bytes(encryptedSymmetricKey).length == 0) {
      revert EncryptedSymmetricKeyMissing();
    }

    if (bytes(encryptedTerms).length == 0) {
      revert EncryptedTermsMissing();
    }

    if (maxPayment == 0) {
      revert MaxPaymentMissing();
    }

    if (redemptionExpiration <= block.timestamp) {
      revert RedemptionExpirationMustBeInFuture();
    }

    uint256 allowance = s_paymentToken.allowance(msg.sender, address(this));

    if (allowance < maxPayment) {
      revert MaxValueAllowanceMissing();
    }

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

    bool success = s_database.insertDeal(dealId, deal);
    require(success);

    emit DealCreated(dealId);
  }

  function getDeal(bytes32 dealId) external view returns (Deal memory) {
    return s_deals[dealId];
  }

  function acceptDeal(bytes32 dealId, string calldata accountOwnershipProof) external {
    if (dealId == bytes32(0)) {
      revert DealDoesNotExist();
    }

    if (bytes(accountOwnershipProof).length == 0) {
      revert AccountOwnershipProofMissing();
    }

    Deal storage deal = s_deals[dealId];

    if (deal.redemptionExpiration < block.timestamp) {
      revert DealExpired();
    }

    if (deal.status != Status.NEW) {
      revert DealStatusMustBeNew();
    }

    FunctionsRequest.Request memory req;

    req.initializeRequest(
      FunctionsRequest.Location.Inline,
      FunctionsRequest.CodeLanguage.JavaScript,
      s_acceptFunctionSource
    );

    req.secretsLocation = FunctionsRequest.Location.Remote;
    req.encryptedSecretsReference = s_encryptedSecretsReference;

    string[] memory args = new string[](1);
    args[0] = accountOwnershipProof;

    req.setArgs(args);

    bytes32 requestId = _sendRequest(req.encodeCBOR(), s_subscriptionId, 300000, s_donId);

    s_acceptRequests[requestId] = dealId;
    s_deals[dealId].creator = msg.sender;
  }

  /**
   * @notice Finish deal accepting or redeeming
   * @param requestId The request ID, returned by sendRequest()
   * @param response Aggregated response from the user code
   * @param err Aggregated error from the user code or from the execution pipeline
   * Either response or error parameter will be set, but never both
   */
  function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
    bytes32 acceptedDealId = s_acceptRequests[requestId];

    if (acceptedDealId != bytes32(0) && response[31] == bytes1(0x01)) {
      Deal storage deal = s_deals[acceptedDealId];
      deal.status = Status.ACCEPTED;

      string memory setter = string.concat(
        "status='Accepted',creator_address='",
        Strings.toHexString(uint160(deal.creator)),
        "'"
      );

      require(s_database.updateDeal(acceptedDealId, setter));

      emit DealAccepted(acceptedDealId);
    } else {
      require(false);
    }
  }

  function _requireDealDoesNotExist(bytes32 dealId) internal view {
    if (s_deals[dealId].sponsor != address(0)) {
      revert DealAlreadyExists();
    }
  }
}
