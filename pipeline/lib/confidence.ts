import { FieldMetaRowSchema, SafeUrlSchema } from '@citizenrun/shared';
import type { FieldMetaRow } from '@citizenrun/shared';

type Confidence = FieldMetaRow['confidence'];

// PIPE-confidence: the one function that turns evidence into a value and its proof (D-073, P8-46).

export type EvidenceKind =
  | 'dataset' // a row of a structured official or open dataset (Census, EIA, IRS, FEC, MEDSL, Open States, a candidate list)
  | 'statute' // a template value whose quote was grounded against the statute page
  | 'computed' // a deadline from packages/rules whose fixtures pass
  | 'notice' // an official calendar or clerk notice, grounded (PIPE-deadline-notices)
  | 'page' // one grounded AI pass on a government page
  | 'page_two_pass' // two agreeing passes on one page (D-073)
  | 'field_report' // a grounded value from a user's official-host link (PIPE-field-report-loop)
  | 'scanned' // a value from a native PDF, ungroundable
  | 'template_default' // a national default or an ungrounded template value
  | 'estimate'; // a modelled value (lean)

export type Evidence = {
  kind: EvidenceKind;
  value: unknown; // canonical form
  source_url: string | null;
  quote: string | null;
  rule_citation: string | null;
  checked_at: string; // ISO instant of the last successful check
};

/** Every evidence kind, in rank order. */
export const EVIDENCE_KINDS = [
  'dataset',
  'statute',
  'notice',
  'computed',
  'page_two_pass',
  'page',
  'field_report',
  'scanned',
  'template_default',
  'estimate',
] as const satisfies readonly EvidenceKind[];

/** The rank of each kind (PIPE-confidence, P8-46). */
export const EVIDENCE_RANK: Readonly<Record<EvidenceKind, number>> = Object.freeze({
  dataset: 7,
  statute: 6,
  notice: 5,
  computed: 4,
  page_two_pass: 3,
  page: 3,
  field_report: 3,
  scanned: 1,
  template_default: 0,
  estimate: 0,
});

/** A value not re-checked for more than this many days drops one level. // PIPE-confidence */
export const FRESHNESS_DAYS = 180;

const MS_PER_DAY = 86_400_000;

/**
 * The B-offices and B-filing_tracks columns that hold a deadline, signature count, fee, where-to-file
 * or pay value (D-598). Their proof always carries an https source_url, or the value is null.
 */
export const ACT_ON_FIELDS: ReadonlySet<string> = new Set([
  'pay_annual_cents',
  'pay_amount_cents',
  'filing_fee_cents',
  'signatures_required',
  'where_to_file',
  'opens_on',
  'closes_on',
  'closes_time',
  'petition_opens',
  'petition_due',
  'fee_cents',
  'signatures',
]);

/** Kinds whose URLs count as distinct sources. */
const SOURCE_KINDS: ReadonlySet<EvidenceKind> = new Set([
  'dataset',
  'statute',
  'notice',
  'page',
  'page_two_pass',
  'field_report',
]);

/** Kinds that carry no grounded quote. */
const UNGROUNDED_KINDS: ReadonlySet<EvidenceKind> = new Set([
  'scanned',
  'template_default',
  'estimate',
]);

/** Kinds that never raise a conflict. */
const NO_CONFLICT_KINDS: ReadonlySet<EvidenceKind> = new Set(['template_default', 'estimate']);

/** A High or Medium result whose proof lacks a URL or a quote: a caller bug. */
export class ProofMissingError extends Error {
  override readonly name = 'ProofMissingError';

  readonly field: string;

  constructor(field: string) {
    super(`a ${field} value above low confidence has no source_url or no quote`);
    this.field = field;
  }
}

function canonicalForm(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const withJson = value as { toJSON?: unknown };
  if (typeof withJson.toJSON === 'function') {
    return canonicalForm((withJson.toJSON as () => unknown).call(value));
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => canonicalForm(item));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalForm((value as Record<string, unknown>)[key]);
  }
  return out;
}

/** `JSON.stringify` with object keys sorted at every depth; `undefined` reads as `null`. */
export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(canonicalForm(value)) as string | undefined;
  return json ?? 'null';
}

/**
 * Scheme and host lower-cased, the path as written without one trailing `/` (unless the path is
 * `/`), no query and no fragment. A string that is not an absolute URL loses only its query and
 * fragment.
 */
export function normaliseSourceUrl(url: string): string {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(url);
  if (match === null) {
    return url.replace(/[?#].*$/s, '');
  }
  const scheme = (match[1] ?? '').toLowerCase();
  const host = (match[2] ?? '').toLowerCase();
  let path = match[3] ?? '';
  if (path === '') {
    path = '/';
  } else if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return `${scheme}://${host}${path}`;
}

function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function checkedMs(evidence: Evidence): number {
  const ms = Date.parse(evidence.checked_at);
  if (Number.isNaN(ms)) {
    throw new TypeError('evidence checked_at is not an ISO instant');
  }
  return ms;
}

function isHttpsUrl(url: string | null): url is string {
  return url !== null && SafeUrlSchema.safeParse(url).success;
}

/** Highest rank first, then the newest check, then canonical byte order: never input order. */
function compareEvidence(a: Evidence, b: Evidence): number {
  return (
    EVIDENCE_RANK[b.kind] - EVIDENCE_RANK[a.kind] ||
    checkedMs(b) - checkedMs(a) ||
    byteCompare(canonicalJson(a), canonicalJson(b))
  );
}

type Group = {
  readonly json: string;
  readonly value: unknown;
  readonly evidence: readonly Evidence[];
  readonly topRank: number;
  readonly sources: number;
  readonly newestMs: number;
};

function distinctSources(evidence: readonly Evidence[]): number {
  const urls = new Set<string>();
  const citations = new Set<string>();
  for (const item of evidence) {
    if (SOURCE_KINDS.has(item.kind) && item.source_url !== null) {
      urls.add(normaliseSourceUrl(item.source_url));
    } else if (item.kind === 'computed' && item.rule_citation !== null) {
      citations.add(item.rule_citation);
    }
  }
  return urls.size + citations.size;
}

function buildGroups(evidence: readonly Evidence[]): Group[] {
  const byJson = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const json = canonicalJson(item.value);
    const list = byJson.get(json);
    if (list === undefined) {
      byJson.set(json, [item]);
    } else {
      list.push(item);
    }
  }
  const groups: Group[] = [];
  for (const [json, items] of byJson) {
    const sorted = [...items].sort(compareEvidence);
    const first = sorted[0];
    if (first === undefined) continue;
    groups.push({
      json,
      value: first.value,
      evidence: sorted,
      topRank: EVIDENCE_RANK[first.kind],
      sources: distinctSources(sorted),
      newestMs: Math.max(...sorted.map(checkedMs)),
    });
  }
  return groups.sort(
    (a, b) =>
      b.topRank - a.topRank ||
      b.sources - a.sources ||
      b.newestMs - a.newestMs ||
      byteCompare(a.json, b.json),
  );
}

function levelOf(group: Group): Confidence {
  const kinds = new Set(group.evidence.map((item) => item.kind));
  if (group.sources >= 2 || (kinds.has('computed') && kinds.has('notice'))) {
    return 'high';
  }
  if (group.sources === 1 || kinds.has('computed')) {
    return 'medium';
  }
  return 'low';
}

function dropOne(level: Confidence): Confidence {
  return level === 'high' ? 'medium' : 'low';
}

/**
 * PIPE-confidence: the winning value among `evidence` for `field`, its proof, and the losing
 * grounded evidence when another value has some. Reads no clock: `now` is an argument.
 */
export function resolve(
  field: string,
  evidence: readonly Evidence[],
  now: Date,
): { value: unknown; meta: FieldMetaRow | null; conflict: Evidence[] | null } {
  // No evidence: no value.
  if (evidence.length === 0) {
    return { value: null, meta: null, conflict: null };
  }
  // Group by canonical value; the first group wins.
  const [winner, ...losers] = buildGroups(evidence);
  if (winner === undefined) {
    return { value: null, meta: null, conflict: null };
  }
  // Level.
  let level = levelOf(winner);
  // A losing group with grounded evidence caps the level at medium.
  const conflictGroups = losers.filter((group) =>
    group.evidence.some((item) => !NO_CONFLICT_KINDS.has(item.kind)),
  );
  const conflict = conflictGroups.length === 0 ? null : conflictGroups.flatMap((g) => g.evidence);
  if (conflict !== null && level === 'high') {
    level = 'medium';
  }
  // The newest check of the winning group; past the freshness window, one level down.
  const checkedAt = winner.newestMs;
  if (now.getTime() - checkedAt > FRESHNESS_DAYS * MS_PER_DAY) {
    level = dropOne(level);
  }
  if (winner.value === null || winner.value === undefined) {
    return { value: null, meta: null, conflict };
  }
  // Proof. The group's evidence is already in proof order: rank, newest check, canonical bytes.
  let proof: Evidence | undefined;
  let quote: string | null;
  if (ACT_ON_FIELDS.has(field)) {
    proof = winner.evidence.find((item) => isHttpsUrl(item.source_url));
    if (proof === undefined) {
      return { value: null, meta: null, conflict };
    }
    quote = UNGROUNDED_KINDS.has(proof.kind) ? null : proof.quote;
  } else {
    proof = winner.evidence.find((item) => isHttpsUrl(item.source_url) && item.quote !== null);
    quote = proof?.quote ?? null;
  }
  const sourceUrl = proof?.source_url ?? null;
  if (level !== 'low' && (sourceUrl === null || quote === null)) {
    throw new ProofMissingError(field);
  }
  const meta: FieldMetaRow = {
    source_url: sourceUrl,
    quote,
    confidence: level,
    checked_at: new Date(checkedAt).toISOString(),
  };
  if (proof?.kind === 'computed' && proof.rule_citation !== null) {
    meta.rule_citation = proof.rule_citation;
  }
  return { value: winner.value, meta: FieldMetaRowSchema.parse(meta), conflict };
}
