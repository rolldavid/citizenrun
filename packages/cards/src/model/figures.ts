import { formatCompact, formatMoney, formatNumber, roundDiv } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { CANVAS } from '../canvas.ts';
import type { CardContext } from '../feed.ts';
import { measureText } from '../layout-text.ts';

// Figures on a canvas (CARD-region-big-number): every builder writes a number through these.

/** Money in full: "$52,900", "$37.50", "$0". */
export function moneyText(cents: number, ctx: CardContext): string {
  return formatMoney(cents, ctx.locale);
}

/** A count in full: "2,100". */
export function countText(n: number, ctx: CardContext): string {
  return formatNumber(n, ctx.locale);
}

/** A count, compact from 10,000: "12.3K", "210K", "1.2M". */
export function compactCountText(n: number, t: TFunction, ctx: CardContext): string {
  return formatCompact(n, ctx.locale, t);
}

/** Whole dollars, compact from $10,000: "$52.9K", "$1.2M". */
export function compactMoneyText(cents: number, t: TFunction, ctx: CardContext): string {
  return t('cards:figure.moneyCompact', {
    value: formatCompact(roundDiv(cents, 100), ctx.locale, t),
  });
}

/** The units between the estimate word and the big number after it. */
const BIG_ABOUT_GAP = 22;

/** The width the estimate word takes before a big number, with its gap; 0 without a word. */
export function bigNumberPrefix(aboutWord: string | null): number {
  return aboutWord === null
    ? 0
    : measureText(aboutWord, { face: 'medium', size: CANVAS.type.bigAbout }) + BIG_ABOUT_GAP;
}

/** True when a figure after its estimate word is wider than the measure at the big number's smallest size. */
export function overflowsBigSlot(value: string, aboutWord: string | null): boolean {
  const width = measureText(value, { face: 'bold', size: CANVAS.type.bigNumber.min });
  return bigNumberPrefix(aboutWord) + width > CANVAS.measure;
}
