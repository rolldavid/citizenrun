import type { TFunction } from '@citizenrun/shared';

/**
 * Joins words into one list, in the catalog's patterns: "Pay", "Pay and hours", "Pay, hours, and
 * benefits". No items give the empty string. Every joined list of words goes through here.
 */
export function formatList(items: readonly string[], t: TFunction): string {
  const [first, second] = items;
  const last = items.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }
  if (second === undefined) {
    return first;
  }
  if (items.length === 2) {
    return t('common:list.pair', { first, second });
  }
  let head = first;
  for (const next of items.slice(1, -1)) {
    head = t('common:list.joiner', { head, next });
  }
  return t('common:list.series', { head, last });
}
