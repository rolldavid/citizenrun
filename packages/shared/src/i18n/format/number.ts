/** Grouping separators, at most `maxFractionDigits` decimals (default 0). Never compact notation (D-185). */
export function formatNumber(value: number, locale: string, maxFractionDigits = 0): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: maxFractionDigits,
    useGrouping: true,
  }).format(value);
}
