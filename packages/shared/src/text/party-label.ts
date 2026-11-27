import type { TFunction } from '../i18n/format/t-function.ts';

/** The word for a party key: the catalog's for the five common keys, else the key with underscores as spaces (02 rule A12). */
export function partyLabel(party: string, t: TFunction): string {
  switch (party) {
    case 'democratic':
      return t('common:party.democratic');
    case 'republican':
      return t('common:party.republican');
    case 'libertarian':
      return t('common:party.libertarian');
    case 'green':
      return t('common:party.green');
    case 'independent':
      return t('common:party.independent');
    default:
      // Any other key is stored data, shown as it is stored (L-party-label).
      return party.replaceAll('_', ' ');
  }
}
