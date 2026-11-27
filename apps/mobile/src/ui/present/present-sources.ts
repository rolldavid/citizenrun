import { formatDate } from '@citizenrun/shared';
import type { FieldMeta, TFunction } from '@citizenrun/shared';
import type { CardContext } from '@citizenrun/cards';

import type { SourcesSheetProps } from '@/ui/components/sources-sheet';

import { formatList } from './list';

export type SourceEntry = SourcesSheetProps['sources'][number];

type Confidence = FieldMeta['confidence'];
type CanvasLine = { field: 'pay' | 'filing' | 'votes'; line: string };

/** One field of a sheet that has a proof. */
type Row = { field: string; label: string; meta: FieldMeta };

/** The rows one entry of the sheet stands for, and the canvas line it prints instead of the page's. */
type Group = { id: string; first: Row; rest: Row[]; canvasLine: string | null };

const CONFIDENCE_ORDER: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 };

/** The host of an https link without a leading "www.", not shortened; null otherwise. */
export function sourceDomain(sourceUrl: string | null): string | null {
  if (sourceUrl === null) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '') {
    return null;
  }
  return url.hostname.replace(/^www\./u, '');
}

/**
 * The date a source was checked, as CARD-region-sources writes it: "Nov 9" in the year of
 * `ctx.now`, "Nov 9, 2026" otherwise, for the UTC date of an ISO instant. Throws RangeError when
 * the instant does not parse.
 */
function checkedDate(checkedAt: string, ctx: CardContext): string {
  if (Number.isNaN(Date.parse(checkedAt))) {
    throw new RangeError('Not an instant.');
  }
  const date = checkedAt.slice(0, 10);
  const sameYear = Number(date.slice(0, 4)) === ctx.now.getUTCFullYear();
  return formatDate(date, ctx.locale, sameYear ? 'short' : 'medium');
}

/** The text of a source row on a page: "wrencounty.gov. Checked Nov 9." */
export function sourceLine(meta: FieldMeta, t: TFunction, ctx: CardContext): string {
  const date = checkedDate(meta.checkedAt, ctx);
  const domain = sourceDomain(meta.sourceUrl);
  if (domain !== null) {
    return t('common:source.line', { domain, date });
  }
  // No link to name: a rule the value was computed from, or nothing.
  return meta.ruleCitation === null
    ? t('common:source.lineNoLink', { date })
    : t('common:source.lineRule', { citation: meta.ruleCitation, date });
}

/** The row whose source was checked longest ago; the first of them when several share the time. */
function oldestOf(first: Row, rest: readonly Row[]): Row {
  let oldest = first;
  for (const row of rest) {
    if (Date.parse(row.meta.checkedAt) < Date.parse(oldest.meta.checkedAt)) {
      oldest = row;
    }
  }
  return oldest;
}

function entryOf(group: Group, t: TFunction, ctx: CardContext): SourceEntry {
  const { first, rest } = group;
  const rows = [first, ...rest];
  let confidence = first.meta.confidence;
  for (const row of rest) {
    if (CONFIDENCE_ORDER[row.meta.confidence] < CONFIDENCE_ORDER[confidence]) {
      confidence = row.meta.confidence;
    }
  }
  const domain = sourceDomain(first.meta.sourceUrl);
  return {
    id: group.id,
    covers: formatList(
      rows.map((row) => row.label),
      t,
    ),
    // The date of the oldest check, so the line never claims a later check than its oldest field's.
    line: group.canvasLine ?? sourceLine(oldestOf(first, rest).meta, t, ctx),
    confidence,
    quote: rows.find((row) => row.meta.quote !== null)?.meta.quote ?? null,
    // A link that is not https is read as no link.
    url: domain === null ? null : first.meta.sourceUrl,
    domain,
  };
}

/**
 * One sheet entry per distinct source of the given fields, in the order of `labels`. A field with
 * no proof is left out, and a field with no link is an entry of its own. On a card's sheet
 * (`canvasLines` given) the pay proof and the filing-deadline proof are always entries of their
 * own and print the lines the canvas prints (C-SourcesSheet).
 */
export function presentSources(
  fieldMeta: Readonly<Record<string, FieldMeta | undefined>>,
  labels: readonly { field: string; label: string }[],
  t: TFunction,
  ctx: CardContext,
  canvasLines?: readonly CanvasLine[],
): SourceEntry[] {
  const proofOf = (field: string): FieldMeta | undefined =>
    Object.hasOwn(fieldMeta, field) ? fieldMeta[field] : undefined;
  // The field whose proof stands behind the pay a canvas prints.
  const payField = proofOf('payAnnualCents') === undefined ? 'payAmountCents' : 'payAnnualCents';
  const canvasFieldOf = (field: string): 'pay' | 'filing' | null => {
    if (canvasLines === undefined) {
      return null;
    }
    if (field === payField) {
      return 'pay';
    }
    return field === 'filingDeadline' ? 'filing' : null;
  };

  const groups: Group[] = [];
  const byLink = new Map<string, Group>();
  for (const { field, label } of labels) {
    const meta = proofOf(field);
    if (meta === undefined) {
      continue;
    }
    const row: Row = { field, label, meta };
    const canvasField = canvasFieldOf(field);
    if (canvasField !== null) {
      // Its link may be another entry's too, so the entry is named by its field.
      const printed = canvasLines?.find((item) => item.field === canvasField);
      groups.push({
        id: `field:${field}`,
        first: row,
        rest: [],
        canvasLine: printed?.line ?? null,
      });
      continue;
    }
    const link = sourceDomain(meta.sourceUrl) === null ? null : meta.sourceUrl;
    if (link === null) {
      groups.push({ id: `field:${field}`, first: row, rest: [], canvasLine: null });
      continue;
    }
    const known = byLink.get(link);
    if (known === undefined) {
      const group: Group = { id: link, first: row, rest: [], canvasLine: null };
      byLink.set(link, group);
      groups.push(group);
    } else {
      known.rest.push(row);
    }
  }
  return groups.map((group) => entryOf(group, t, ctx));
}
