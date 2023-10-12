// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/FunctionsClient.sol";
// import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
// import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/libraries/FunctionsRequest.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@tableland/evm/contracts/utils/TablelandDeployments.sol";

contract SponsorshipMarketplace is
  ERC721Holder //is FunctionsClient, ConfirmedOwner {
{
  // Offer status codes
  uint256 public constant UNKNOWN = 0;
  uint256 public constant NEW = 1;
  uint256 public constant WITHDRAWN = 2;
  uint256 public constant ACCEPTED = 3;
  uint256 public constant CANCELLED = 4;

  mapping(uint256 offerId => uint256 status) private s_offerStatuses;
  mapping(uint256 offerId => uint256 timestamp) private s_offerAcceptExpirations;
  uint256 private s_tableId;
  string private s_tableName;

  error OfferIdMissing();
  error AcceptExpirationTimestampMissing();
  error AcceptExpirationTimestampInPast();
  error OfferDataMissing();
  error OfferAlreadyExists();

  event OfferCreated(uint256 offerId);
  event DatabaseTableCreated(uint256 tableName);

  constructor() {
    string memory chainId = Strings.toString(block.chainid);

    uint256 tableId = TablelandDeployments.get().create(
      address(this),
      string.concat("CREATE TABLE offers_", chainId, " (id integer primary key, offerData text);")
    );

    s_tableId = tableId;

    s_tableName = string.concat("offers_", chainId, "_", Strings.toString(tableId));
  }

  function createOffer(uint256 offerId, uint256 acceptExpiresAt, bytes calldata offerData) external {
    _requireOfferId(offerId);
    _requireOfferDoesNotExist(offerId);

    _requireAcceptExpirationTimestamp(acceptExpiresAt);
    _requireAcceptExpirationTimestampInFuture(acceptExpiresAt);

    _requireOfferData(offerData);

    s_offerStatuses[offerId] = NEW;
    s_offerAcceptExpirations[offerId] = acceptExpiresAt;

    // TODO: write data to the tableland

    emit OfferCreated(offerId);
  }

  function _requireOfferId(uint256 offerId) internal pure {
    if (offerId == 0) {
      revert OfferIdMissing();
    }
  }

  function _requireOfferDoesNotExist(uint256 offerId) internal view {
    if (s_offerStatuses[offerId] != UNKNOWN) {
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
