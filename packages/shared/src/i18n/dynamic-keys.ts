import { STATE_CODES } from '../constants/geo.ts';

/**
 * Catalog keys that code reaches only through a computed lookup, never as a literal `t('...')`
 * argument, each written as `<namespace>:<key>` with the reason. The catalog check counts them as
 * used.
 */
const ISSUE_SHORT = 'built from ISSUE_IDS';
const STATE_NAME = 'built from STATE_CODES (lower-case code)';
const EMAIL_STATUS = 'built from Me.emailStatus';
const OFFICE_TYPE_SHORT =
  "CARD-text-fold: the office type's short name drawn when an office title cannot be drawn";

export const DYNAMIC_KEYS: readonly { key: string; reason: string }[] = [
  { key: 'common:issueShort.rentHousing', reason: ISSUE_SHORT },
  { key: 'common:issueShort.utilityBills', reason: ISSUE_SHORT },
  { key: 'common:issueShort.dataCentersAi', reason: ISSUE_SHORT },
  { key: 'common:issueShort.climate', reason: ISSUE_SHORT },
  { key: 'common:issueShort.corporateSubsidies', reason: ISSUE_SHORT },
  { key: 'common:issueShort.propertyTaxes', reason: ISSUE_SHORT },
  { key: 'common:issueShort.wagesWorkers', reason: ISSUE_SHORT },
  { key: 'common:issueShort.policingJustice', reason: ISSUE_SHORT },
  { key: 'common:issueShort.healthcare', reason: ISSUE_SHORT },
  { key: 'common:issueShort.medicareForAll', reason: ISSUE_SHORT },
  { key: 'common:issueShort.schools', reason: ISSUE_SHORT },
  { key: 'common:issueShort.waterLand', reason: ISSUE_SHORT },
  { key: 'common:issueShort.transit', reason: ISSUE_SHORT },
  { key: 'common:issueShort.votingAccess', reason: ISSUE_SHORT },
  { key: 'common:issueShort.moneyInPolitics', reason: ISSUE_SHORT },
  { key: 'common:issueShort.nominations', reason: ISSUE_SHORT },
  { key: 'common:issueShort.publicMoney', reason: ISSUE_SHORT },
  { key: 'common:issueShort.defundIsrael', reason: ISSUE_SHORT },
  { key: 'common:issueShort.foreignWars', reason: ISSUE_SHORT },
  ...STATE_CODES.map((code) => ({
    key: `common:state.${code.toLowerCase()}`,
    reason: STATE_NAME,
  })),
  { key: 'settings:account.emailStatus.bounced', reason: EMAIL_STATUS },
  { key: 'settings:account.emailStatus.complained', reason: EMAIL_STATUS },
  { key: 'settings:account.emailStatus.disabled', reason: EMAIL_STATUS },
  { key: 'cards:officeType.usSenate', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.usHouse', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.governor', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.statewideExecutiveOther', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.attorneyGeneral', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.secretaryOfState', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.stateTreasurer', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.stateSenate', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.stateHouse', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.utilityCommission', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.oilGasLandCommission', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.insuranceCommissioner', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.laborCommissioner', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.stateEducationBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.stateAppellateJudge', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.countyCommission', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.countyExecutive', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.sheriff', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.districtAttorney', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.countyClerk', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.countyTreasurer', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.countyAssessor', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.boardOfReview', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.trialJudge', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.countyRowOther', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.mayor', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.cityCouncil', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.townshipBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.cityOfficer', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.schoolBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.communityCollegeBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.waterDistrictBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.soilWaterConservationBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.hospitalDistrictBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.transitBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.publicPowerBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.fireDistrictBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.specialDistrictOther', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.coopBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.pensionBoard', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.partyPrecinctCommittee', reason: OFFICE_TYPE_SHORT },
  { key: 'cards:officeType.partyCommittee', reason: OFFICE_TYPE_SHORT },
];
