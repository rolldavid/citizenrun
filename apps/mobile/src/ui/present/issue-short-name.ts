import { assertNever, isIssueId } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';

/**
 * The short name of an issue ("Rent", "Schools"). Null for an id this build does not know: the
 * caller then shows the name the issue is stored with.
 */
export function issueShortName(issueId: string, t: TFunction): string | null {
  if (!isIssueId(issueId)) {
    return null;
  }
  // One literal call per id, so the catalog check can read every key.
  switch (issueId) {
    case 'rent-housing':
      return t('common:issueShort.rentHousing');
    case 'utility-bills':
      return t('common:issueShort.utilityBills');
    case 'data-centers-ai':
      return t('common:issueShort.dataCentersAi');
    case 'climate':
      return t('common:issueShort.climate');
    case 'corporate-subsidies':
      return t('common:issueShort.corporateSubsidies');
    case 'property-taxes':
      return t('common:issueShort.propertyTaxes');
    case 'wages-workers':
      return t('common:issueShort.wagesWorkers');
    case 'policing-justice':
      return t('common:issueShort.policingJustice');
    case 'healthcare':
      return t('common:issueShort.healthcare');
    case 'medicare-for-all':
      return t('common:issueShort.medicareForAll');
    case 'schools':
      return t('common:issueShort.schools');
    case 'water-land':
      return t('common:issueShort.waterLand');
    case 'transit':
      return t('common:issueShort.transit');
    case 'voting-access':
      return t('common:issueShort.votingAccess');
    case 'money-in-politics':
      return t('common:issueShort.moneyInPolitics');
    case 'nominations':
      return t('common:issueShort.nominations');
    case 'public-money':
      return t('common:issueShort.publicMoney');
    case 'defund-israel':
      return t('common:issueShort.defundIsrael');
    case 'foreign-wars':
      return t('common:issueShort.foreignWars');
    default:
      return assertNever(issueId);
  }
}
