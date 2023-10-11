// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/FunctionsClient.sol";
// import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
// import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/libraries/FunctionsRequest.sol";

contract SponsorshipMarketplace {
  //is FunctionsClient, ConfirmedOwner {
  // Offer status codes
  uint256 public constant UNKNOWN = 0;
  uint256 public constant NEW = 1;
  uint256 public constant WITHDRAWN = 2;
  uint256 public constant ACCEPTED = 3;
  uint256 public constant CANCELLED = 4;

  mapping(uint256 offerId => uint256 status) private offerStatuses;
  mapping(uint256 offerId => uint256 timestamp) private offerAcceptExpirations;

  error OfferIdMissing();
  error AcceptExpirationTimestampMissing();
  error AcceptExpirationTimestampInPast();
  error OfferDataMissing();
  error OfferAlreadyExists();

  event OfferCreated(uint256 offerId);

  constructor() {
    // TODO: create a table in Tableland here
  }

  function createOffer(uint256 offerId, uint256 acceptExpiresAt, bytes calldata offerData) external {
    _requireOfferId(offerId);
    _requireOfferDoesNotExist(offerId);

    _requireAcceptExpirationTimestamp(acceptExpiresAt);
    _requireAcceptExpirationTimestampInFuture(acceptExpiresAt);

    _requireOfferData(offerData);

    offerStatuses[offerId] = NEW;
    offerAcceptExpirations[offerId] = acceptExpiresAt;

    // TODO: write data to the tableland

    emit OfferCreated(offerId);
  }

  function _requireOfferId(uint256 offerId) internal pure {
    if (offerId == 0) {
      revert OfferIdMissing();
    }
  }

  function _requireOfferDoesNotExist(uint256 offerId) internal view {
    if (offerStatuses[offerId] != UNKNOWN) {
      revert OfferAlreadyExists();
    }
  }

  function _requireAcceptExpirationTimestamp(uint256 acceptExpiresAt) internal pure {
    if (acceptExpiresAt == 0) {
      revert AcceptExpirationTimestampMissing();
    }
  }

  function _requireAcceptExpirationTimestampInFuture(uint256 acceptExpirationTimestamp) internal view {
    if (acceptExpirationTimestamp <= block.timestamp) {
      revert AcceptExpirationTimestampInPast();
    }
  }

  function _requireOfferData(bytes calldata offerData) internal view {
    if (offerData.length == 0) {
      revert OfferDataMissing();
    }
  }
}
