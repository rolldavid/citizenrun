import { roundDiv } from '../../num/rounding.ts';
import { formatNumber } from './number.ts';
import type { TFunction } from './t-function.ts';

/** Below this an integer is written in full (L-format-compact). */
const COMPACT_FROM = 10_000;
/** Below this formatBigNumber writes the number in full (L-format-compact). */
const BIG_NUMBER_COMPACT_FROM = 100_000;
/** The three units (L-format-compact). */
const THOUSAND = 1_000;
const MILLION = 1_000_000;
const BILLION = 1_000_000_000;
/** In tenths of a unit: from here the next unit is used (L-format-compact). */
const NEXT_UNIT_FROM_TENTHS = 10_000;
/** In tenths of a unit: from here the whole number is shown, with no decimal (L-format-compact). */
const WHOLE_FROM_TENTHS = 1_000;

/** The largest unit not above `a`, for `a` of at least a thousand. */
function unitFor(a: number): number {
  if (a >= BILLION) {
    return BILLION;
  }
  return a >= MILLION ? MILLION : THOUSAND;
}

function nextUnit(unit: number): number | null {
  if (unit === THOUSAND) {
    return MILLION;
  }
  return unit === MILLION ? BILLION : null;
}

function wrap(unit: number, value: string, t: TFunction): string {
  if (unit === THOUSAND) {
    return t('common:compact.thousand', { value });
  }
  if (unit === MILLION) {
    return t('common:compact.million', { value });
  }
  return t('common:compact.billion', { value });
}

/** 10,000 and up as 10K, 12.3K, 593K, 1.2M, 1.5B; below 10,000 as formatNumber. RangeError for a non-integer. */
export function formatCompact(value: number, locale: string, t: TFunction): string {
  if (!Number.isInteger(value)) {
    throw new RangeError('formatCompact takes an integer.');
  }
  const a = Math.abs(value);
  if (a < COMPACT_FROM) {
    return formatNumber(value, locale);
  }
  let unit = unitFor(a);
  let tenths = roundDiv(a * 10, unit);
  const next = nextUnit(unit);
  if (tenths >= NEXT_UNIT_FROM_TENTHS && next !== null) {
    unit = next;
    tenths = roundDiv(a * 10, unit);
  }
  const shown = tenths >= WHOLE_FROM_TENTHS ? roundDiv(a, unit) : tenths / 10;
  // One decimal at most; Intl drops a trailing .0 by itself.
  const number = formatNumber(shown, locale, 1);
  return wrap(unit, value < 0 ? `-${number}` : number, t);
}

/** formatNumber below 100,000 and formatCompact from there. RangeError for a non-integer. */
export function formatBigNumber(value: number, locale: string, t: TFunction): string {
  if (!Number.isInteger(value)) {
    throw new RangeError('formatBigNumber takes an integer.');
  }
  return Math.abs(value) < BIG_NUMBER_COMPACT_FROM
    ? formatNumber(value, locale)
    : formatCompact(value, locale, t);
}
