// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/FunctionsClient.sol";
// import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
// import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/libraries/FunctionsRequest.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@tableland/evm/contracts/utils/TablelandDeployments.sol";
import "@tableland/evm/contracts/utils/SQLHelpers.sol";

contract SponsorshipMarketplace is ERC721Holder {
  // is FunctionsClient, ConfirmedOwner {

  struct User {
    string id;
    address accountAddress;
  }

  struct Proposal {
    string id;
    string creatorId;
    string sponsorId;
    uint256 paymentAmount;
    string requirements;
    uint256 deliveryDeadline;
  }

  using Strings for uint256;

  // Deal status codes
  uint256 public constant UNKNOWN = 0;
  uint256 public constant NEW = 1;
  uint256 public constant WITHDRAWN = 2;
  uint256 public constant ACCEPTED = 3;
  uint256 public constant CANCELLED = 4;

  mapping(string dealId => uint256 status) private s_dealStatuses;
  mapping(string dealId => uint256 timestamp) private s_dealDeliveryDeadlines;
  mapping(string creatorId => bool exists) private s_creatorIds;
  mapping(string sponsorId => bool exists) private s_sponsorIds;

  uint256 private constant USERS_TABLE_INDEX = 0;
  uint256 private constant DEALS_TABLE_INDEX = 1;

  address public s_paymentToken;

  uint256[2] private s_tableIds;
  string[2] public s_tableNames;

  error DealIdMissing();
  error DeliveryDeadlineInPast();
  error RequirementsMissing();
  error DealAlreadyExists();

  error CreatorIdMissing();
  error SponsorIdMissing();
  error CreatorIdsDiffer();
  error SponsorIdsDiffer();
  error SponsorAddressMustMatchSender();

  event DealCreated(string dealId);

  constructor(address paymentToken) {
    s_paymentToken = paymentToken;

    _createTable(
      USERS_TABLE_INDEX,
      "users",
      "id text primary key, "
      "twitter_account_id text, "
      "address text"
    );

    _createTable(
      DEALS_TABLE_INDEX,
      "deals",
      "id text primary key, "
      "creator_id text, "
      "sponsor_id text, "
      "status text, "
      "payment_amount text, "
      "payment_token text, "
      "tweet_id text, "
      "requirements text, "
      "created_at integer, "
      "delivery_deadline integer, "
      "delivery_attempts integer"
    );
  }

  function createDeal(User calldata creator, User calldata sponsor, Proposal calldata proposal) external {
    _runCreateDealValidations(creator, sponsor, proposal);

    s_dealStatuses[proposal.id] = NEW;
    s_dealDeliveryDeadlines[proposal.id] = proposal.deliveryDeadline;

    _handleCreatorAndSponsorRecords(creator, sponsor);

    _insertDealRow(proposal);

    emit DealCreated(proposal.id);
  }

  function _runCreateDealValidations(
    User calldata creator,
    User calldata sponsor,
    Proposal calldata proposal
  ) internal view {
    _requireDealId(proposal.id);
    _requireDealDoesNotExist(proposal.id);

    _requireCreatorId(proposal.creatorId);
    _requireCreatorIdMatchesDeal(creator.id, proposal.creatorId);

    _requireSponsorId(proposal.sponsorId);
    _requireSponsorAddressMatchesSender(sponsor.accountAddress);
    _requireSponsorIdMatchesDeal(creator.id, proposal.creatorId);

    _requireDealRequirements(proposal.requirements);
    _requireDeliveryDeadlineInFuture(proposal.deliveryDeadline);
  }

  // TODO: use proper function ordering in this file
  function _requireCreatorIdMatchesDeal(string calldata creatorId, string calldata proposalCreatorId) internal view {
    if (keccak256(abi.encodePacked(creatorId)) != keccak256(abi.encodePacked(proposalCreatorId))) {
      revert CreatorIdsDiffer();
    }
  }

  function _requireSponsorIdMatchesDeal(string calldata sponsorId, string calldata proposalSponsorId) internal view {
    if (keccak256(abi.encodePacked(sponsorId)) != keccak256(abi.encodePacked(proposalSponsorId))) {
      revert SponsorIdsDiffer();
    }
  }

  function _requireSponsorAddressMatchesSender(address accountAddress) internal view {
    if (accountAddress != msg.sender) {
      revert SponsorAddressMustMatchSender();
    }
  }

  function _createTable(uint256 index, string memory prefix, string memory columns) internal {
    string memory schema = string.concat(SQLHelpers.toCreateFromSchema(columns, prefix), ";");
    string memory chainId = Strings.toString(block.chainid);

    uint256 tableId = TablelandDeployments.get().create(address(this), schema);
    string memory fullName = string.concat(prefix, "_", chainId, "_", Strings.toString(tableId));

    s_tableIds[index] = tableId;
    s_tableNames[index] = fullName;
  }

  function _handleCreatorAndSponsorRecords(User calldata creator, User calldata sponsor) internal {
    if (!_creatorExists(creator.id)) {
      _insertCreatorRow(creator.id, "NULL", creator.accountAddress);
    }

    if (!_sponsorExists(sponsor.id)) {
      _insertSponsorRow(sponsor.id);
    }
  }

  function _creatorExists(string calldata creatorId) internal view returns (bool) {
    return s_creatorIds[creatorId];
  }

  function _sponsorExists(string calldata sponsorId) internal view returns (bool) {
    return s_sponsorIds[sponsorId];
  }

  function _insertCreatorRow(
    string calldata creatorId,
    string memory twitterAccountId,
    address creatorAddress
  ) internal {
    _insertUserRow(creatorId, twitterAccountId, creatorAddress);
  }

  function _insertSponsorRow(string calldata sponsorId) internal {
    _insertUserRow(sponsorId, "NULL", msg.sender);
  }

  function _insertUserRow(string calldata id, string memory twitter_account_id, address userAddress) internal {
    uint256 tableId = s_tableIds[USERS_TABLE_INDEX];

    TablelandDeployments.get().mutate(
      address(this),
      tableId,
      SQLHelpers.toInsert(
        "users",
        tableId,
        "id,twitter_account_id,address",
        string.concat(
          SQLHelpers.quote(id),
          ",",
          SQLHelpers.quote(twitter_account_id),
          ",",
          SQLHelpers.quote(Strings.toHexString(userAddress))
        )
      )
    );
  }

  function _insertDealRow(Proposal calldata proposal) internal {
    uint256 tableId = s_tableIds[DEALS_TABLE_INDEX];

    // "deals",
    //   "id text primary key, "
    //   "creator_id text, "
    //   "sponsor_id text, "
    //   "status text, "
    //   "payment_amount text, "
    //   "payment_token text, "
    //   "tweet_id text, "
    //   "requirements text, "
    //   "created_at integer, "
    //   "delivery_deadline integer, "
    //   "delivery_attempts integer"
    TablelandDeployments.get().mutate(address(this), tableId, _dealInsertSql(tableId, proposal));
  }

  function _dealInsertSql(uint256 tableId, Proposal calldata proposal) internal returns (string memory) {
    string memory columns = "id,"
    "creator_id,"
    "sponsor_id,"
    "status,"
    "payment_amount,"
    "payment_token,"
    "requirements,"
    "created_at,"
    "delivery_deadline";
    string memory values = string.concat(
      SQLHelpers.quote(proposal.id),
      ",",
      SQLHelpers.quote(proposal.creatorId),
      ",",
      SQLHelpers.quote(proposal.sponsorId),
      ",",
      SQLHelpers.quote("NEW"),
      ",",
      proposal.paymentAmount.toString(),
      ",",
      SQLHelpers.quote(Strings.toHexString(uint160(s_paymentToken))),
      ",",
      "NULL",
      ",",
      SQLHelpers.quote(proposal.requirements),
      ",",
      block.timestamp.toString(),
      ",",
      proposal.deliveryDeadline.toString(),
      ",",
      "0"
    );

    return SQLHelpers.toInsert("deals", tableId, columns, values);
  }

  function _requireDealId(string calldata dealId) internal pure {
    if (bytes(dealId).length == 0) {
      revert DealIdMissing();
    }
  }

  function _requireCreatorId(string calldata creatorId) internal view {
    if (s_creatorIds[creatorId]) {
      revert CreatorIdMissing();
    }
  }

  function _requireSponsorId(string calldata sponsorId) internal view {
    if (s_sponsorIds[sponsorId]) {
      revert SponsorIdMissing();
    }
  }

  function _requireDealDoesNotExist(string calldata dealId) internal view {
    if (s_dealStatuses[dealId] != UNKNOWN) {
      revert DealAlreadyExists();
    }
  }

  function _requireDeliveryDeadlineInFuture(uint256 deliveryDeadline) internal view {
    if (deliveryDeadline <= block.timestamp) {
      revert DeliveryDeadlineInPast();
    }
  }

  function _requireDealRequirements(string calldata requirements) internal view {
    if (bytes(requirements).length == 0) {
      revert RequirementsMissing();
    }
  }
}
