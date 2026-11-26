/** US dollars from integer cents: whole dollars when the amount is whole, else two decimals; RangeError for a fraction of a cent. */
export function formatMoney(cents: number, locale: string): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError('Money is held in whole cents.');
  }
  const digits = cents % 100 === 0 ? 0 : 2;
  // The one place cents become dollars for display.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}
