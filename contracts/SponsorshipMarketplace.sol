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
    string sponsorEncryptedSymmetricKey;
    string creatorEncryptedSymmetricKey;
  }

  using Strings for uint256;

  ApeCoin public s_paymentToken;
  Database public s_database;

  bytes32 public s_donId;
  bytes public s_encryptedSecretsReference;
  uint64 public s_subscriptionId;

  string public s_acceptFunctionSource;
  string public s_redeemFunctionSource;

  struct PendingCreator {
    bytes32 dealId;
    address pendingCreator;
    string creatorEncryptedSymmetricKey;
  }

  mapping(bytes32 id => Deal deal) private s_deals;
  mapping(bytes32 requestId => PendingCreator) private s_acceptRequests;
  mapping(bytes32 requestId => bytes32 dealId) private s_redeemRequests;

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
  error InvalidDealId();
  error EncryptedTweetIdMissing();
  error CannotWithdraw();

  event DealCreated(bytes32 dealId);
  event DealAccepted(bytes32 dealId);
  event DealRedeemed(bytes32 dealId, uint256 totalAmount);
  event DealWithdrawn(bytes32 dealId);

  event FunctionError(bytes errorMessage);

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
  function setRedeemFunctionSource(string calldata source) external {
    s_redeemFunctionSource = source;
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
    uint256 redemptionExpiration,
    string calldata sponsorEncryptedSymmetricKey
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
      "",
      sponsorEncryptedSymmetricKey,
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

  function canUserDecrypt(address user, bytes32 dealId) external view returns (bool) {
    return s_deals[dealId].sponsor == user || s_deals[dealId].creator == user;
  }

  // These 2 functions are added for convenience
  function getSponsorEncryptedSymmetricKey(bytes32 dealId) external view returns (string memory) {
    return s_deals[dealId].sponsorEncryptedSymmetricKey;
  }

  function getCreatorEncryptedSymmetricKey(bytes32 dealId) external view returns (string memory) {
    return s_deals[dealId].creatorEncryptedSymmetricKey;
  }

  function acceptDeal(
    bytes32 dealId,
    string calldata accountOwnershipProof,
    string calldata creatorEncryptedSymmetricKey
  ) external {
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

    string[] memory args = new string[](3);
    args[0] = deal.encryptedSymmetricKey;
    args[1] = deal.encryptedTerms;
    args[2] = accountOwnershipProof;

    req.setArgs(args);

    bytes32 requestId = _sendRequest(req.encodeCBOR(), s_subscriptionId, 300000, s_donId);

    PendingCreator memory pendingCreator = PendingCreator({
      dealId: dealId,
      pendingCreator: msg.sender,
      creatorEncryptedSymmetricKey: creatorEncryptedSymmetricKey
    });

    s_acceptRequests[requestId] = pendingCreator;
  }

  function redeemDeal(bytes32 dealId, string calldata encryptedTweetId) external {
    if (bytes(encryptedTweetId).length == 0) {
      revert EncryptedTweetIdMissing();
    }

    Deal storage deal = s_deals[dealId];

    if (deal.creator != msg.sender || deal.status != Status.ACCEPTED) {
      revert InvalidDealId();
    }

    if (deal.redemptionExpiration < block.timestamp) {
      revert DealExpired();
    }

    FunctionsRequest.Request memory req;

    req.initializeRequest(
      FunctionsRequest.Location.Inline,
      FunctionsRequest.CodeLanguage.JavaScript,
      s_redeemFunctionSource
    );

    req.secretsLocation = FunctionsRequest.Location.Remote;
    req.encryptedSecretsReference = s_encryptedSecretsReference;

    string[] memory args = new string[](3);
    args[0] = deal.encryptedSymmetricKey;
    args[1] = deal.encryptedTerms;
    args[2] = encryptedTweetId;

    req.setArgs(args);

    bytes32 requestId = _sendRequest(req.encodeCBOR(), s_subscriptionId, 300000, s_donId);

    deal.encryptedTweetId = encryptedTweetId;
    s_redeemRequests[requestId] = dealId;
  }

  function withdrawDeal(bytes32 dealId) external {
    Deal storage deal = s_deals[dealId];

    if (deal.sponsor != msg.sender) {
      revert CannotWithdraw();
    }

    // Allowed:
    //   * new deal, not expired
    //   * new deal, expired
    //   * accepted deal, expired
    // Not allowed:
    //   * accepted deal, not expired
    //   * redeemed deal, not expired
    //   * redeemed deal, expired

    if (
      !(deal.status == Status.NEW || (deal.status == Status.ACCEPTED && deal.redemptionExpiration < block.timestamp))
    ) {
      revert CannotWithdraw();
    }

    if (deal.status == Status.ACCEPTED) {
      require(s_paymentToken.transfer(deal.sponsor, deal.maxPayment));
    }

    deal.status = Status.WITHDRAWN;

    require(s_database.updateDeal(dealId, "status='Withdrawn'"));

    emit DealWithdrawn(dealId);
  }

  /**
   * @notice Finish deal accepting or redeeming
   * @param requestId The request ID, returned by sendRequest()
   * @param response Aggregated response from the user code
   * @param err Aggregated error from the user code or from the execution pipeline
   * Either response or error parameter will be set, but never both
   */
  function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
    PendingCreator memory pendingCreator = s_acceptRequests[requestId];
    bytes32 redeemedDealId = s_redeemRequests[requestId];

    if (pendingCreator.dealId != bytes32(0) && response.length > 0 && response[31] == bytes1(0x01)) {
      Deal storage deal = s_deals[pendingCreator.dealId];
      deal.creator = pendingCreator.pendingCreator;
      deal.creatorEncryptedSymmetricKey = pendingCreator.creatorEncryptedSymmetricKey;

      uint256 balance = s_paymentToken.balanceOf(deal.sponsor);
      uint256 allowance = s_paymentToken.allowance(deal.sponsor, address(this));

      if (balance < deal.maxPayment || allowance < deal.maxPayment) {
        bytes memory empty = "";
        emit FunctionError(empty);
        return;
      }

      bool transferDone = s_paymentToken.transferFrom(deal.sponsor, address(this), deal.maxPayment);
      if (!transferDone) {
        bytes memory empty = "";
        emit FunctionError(empty);
      }

      deal.status = Status.ACCEPTED;

      string memory setter = string.concat(
        "status='Accepted',creator_address='",
        Strings.toHexString(uint160(deal.creator)),
        "'"
      );

      require(s_database.updateDeal(pendingCreator.dealId, setter));

      emit DealAccepted(pendingCreator.dealId);
    } else if (redeemedDealId != bytes32(0) && response.length == 32) {
      Deal storage deal = s_deals[redeemedDealId];

      uint256 redeemedAmount = uint256(bytes32(response));
      uint256 payout = redeemedAmount > deal.maxPayment ? deal.maxPayment : redeemedAmount;
      bool transfersDone = s_paymentToken.transfer(deal.creator, payout);

      if (redeemedAmount < deal.maxPayment) {
        transfersDone = transfersDone && s_paymentToken.transfer(deal.sponsor, deal.maxPayment - redeemedAmount);
      }

      if (!transfersDone) {
        bytes memory empty = "";
        emit FunctionError(empty);
      }

      deal.status = Status.REDEEMED;

      string memory setter = string.concat(
        "status='Redeemed',redeemed_amount='",
        payout.toString(),
        "',",
        "encrypted_tweet_id='",
        deal.encryptedTweetId,
        "'"
      );

      require(s_database.updateDeal(redeemedDealId, setter));

      emit DealRedeemed(redeemedDealId, redeemedAmount);
    } else {
      emit FunctionError(err);
    }
  }

  function _requireDealDoesNotExist(bytes32 dealId) internal view {
    if (s_deals[dealId].sponsor != address(0)) {
      revert DealAlreadyExists();
    }
  }
}
