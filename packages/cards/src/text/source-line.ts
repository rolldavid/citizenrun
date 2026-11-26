import { formatDate } from '@citizenrun/shared';
import type { FieldMeta, OfficeSummary, TFunction } from '@citizenrun/shared';
import type { CardContext } from '../feed.ts';

// The text half of CARD-region-sources (D-540, D-568): the source lines of an office canvas, which the
// sources sheet under the card prints too. A line is at most 39 mono characters, and the date checked
// is never cut: the publisher is shortened instead.

const LINE_MAX = 39;
const ELLIPSIS = '…';

/** The host of an https URL without a leading "www.", shortened to maxChars characters. Null when the URL is null or not https. */
export function publisherOf(sourceUrl: string | null, maxChars: number): string | null {
  if (sourceUrl === null) return null;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (maxChars < 2) return ELLIPSIS;
  let labels = url.hostname
    .toLowerCase()
    .replace(/^www\./u, '')
    .split('.');
  // A country-code host keeps three labels, so it never loses its owner's name.
  const minimum = /^[a-z]{2}$/u.test(labels.at(-1) ?? '') ? 3 : 2;
  while (labels.join('.').length > maxChars && labels.length > minimum) {
    labels = labels.slice(1);
  }
  const host = labels.join('.');
  return host.length > maxChars ? host.slice(0, maxChars - 1) + ELLIPSIS : host;
}

/** "Nov 9" in the year of ctx.now, "Nov 9, 2026" otherwise, for the UTC date of an ISO instant. Throws RangeError when it does not parse. */
export function checkedDate(checkedAt: string, ctx: CardContext): string {
  if (Number.isNaN(Date.parse(checkedAt))) {
    throw new RangeError('Not an instant.');
  }
  const date = checkedAt.slice(0, 10);
  const sameYear = Number(date.slice(0, 4)) === ctx.now.getUTCFullYear();
  return formatDate(date, ctx.locale, sameYear ? 'short' : 'medium');
}

type SourceLine = { field: 'pay' | 'filing' | 'votes'; line: string };

/** A publisher for a line whose text without it is `rest`: what the line has room for. */
function publisherFor(proof: FieldMeta, rest: string): string | null {
  return proof.confidence === 'low'
    ? null
    : publisherOf(proof.sourceUrl, LINE_MAX - Array.from(rest).length);
}

function payLine(proof: FieldMeta, t: TFunction, ctx: CardContext): string {
  const date = checkedDate(proof.checkedAt, ctx);
  const publisher = publisherFor(proof, t('cards:source.pay', { publisher: '', date }));
  return publisher === null
    ? t('cards:source.payLow', { date })
    : t('cards:source.pay', { publisher, date });
}

function filingLine(proof: FieldMeta, t: TFunction, ctx: CardContext): string {
  const date = checkedDate(proof.checkedAt, ctx);
  const publisher = publisherFor(proof, t('cards:source.filing', { publisher: '', date }));
  return publisher === null
    ? t('cards:source.filingLow', { date })
    : t('cards:source.filing', { publisher, date });
}

function payKnown(office: OfficeSummary): boolean {
  return (
    office.payKind === 'none' ||
    office.payAnnualCents !== null ||
    (office.payAmountCents !== null && office.payPeriod !== null)
  );
}

/**
 * The source lines of an office's canvas as text, each with the field it covers: pay, then filing,
 * then votes, at most one per field, whether or not a canvas has room to draw it. A field with no
 * value or no proof has no line; an office with none gives an empty list.
 */
export function officeSourceLines(
  office: OfficeSummary,
  t: TFunction,
  ctx: CardContext,
): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  const payProof = office.fieldMeta.payAnnualCents ?? office.fieldMeta.payAmountCents;
  if (payKnown(office) && payProof !== undefined) {
    lines.push({ field: 'pay', line: payLine(payProof, t, ctx) });
  }
  const filingProof = office.fieldMeta.filingDeadline;
  if (office.filingDeadline !== null && filingProof !== undefined) {
    lines.push({ field: 'filing', line: filingLine(filingProof, t, ctx) });
  }
  if (office.votesToWin !== null && office.votesEstimated !== null) {
    lines.push({
      field: 'votes',
      line: office.votesEstimated
        ? t('cards:source.votesEstimate')
        : t('cards:source.votesResults'),
    });
  }
  return lines;
}
