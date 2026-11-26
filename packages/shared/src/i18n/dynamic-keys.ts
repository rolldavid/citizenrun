import { STATE_CODES } from '../constants/geo.ts';

/**
 * Catalog keys that code reaches only through a computed lookup, never as a literal `t('...')`
 * argument, each written as `<namespace>:<key>` with the reason. The catalog check counts them as
 * used.
 */
const ISSUE_SHORT = 'built from ISSUE_IDS';
const STATE_NAME = 'built from STATE_CODES (lower-case code)';
const EMAIL_STATUS = 'built from Me.emailStatus';

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
];
