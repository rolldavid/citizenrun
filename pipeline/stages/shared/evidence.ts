// Evidence builders over PIPE-confidence's Evidence type, for the facts every stage writes and the
// bundle writer's merge.
import type { Citation } from '@citizenrun/rules';
import { assertNever } from '@citizenrun/shared';
import type { FieldMetaRow } from '@citizenrun/shared';
import type { Evidence, EvidenceKind } from '../../lib/confidence.ts';
import type { Fact } from '../../lib/facts.ts';
import type { StageId } from '../../lib/runner.ts';

type Proof = {
  readonly source_url: string | null;
  readonly quote: string | null;
  readonly checked_at: string;
};

/** A value from a row of a structured dataset. */
export function datasetEvidence(value: unknown, proof: Proof): Evidence {
  return {
    kind: 'dataset',
    value,
    source_url: proof.source_url,
    quote: proof.quote,
    rule_citation: null,
    checked_at: proof.checked_at,
  };
}

/** A template value whose quote was grounded against its statute page. */
export function statuteEvidence(
  value: unknown,
  proof: Proof & { readonly rule_citation: string | null },
): Evidence {
  return {
    kind: 'statute',
    value,
    source_url: proof.source_url,
    quote: proof.quote,
    rule_citation: proof.rule_citation,
    checked_at: proof.checked_at,
  };
}

/** A national default or an ungrounded template value, with no proof (D-319). */
export function templateDefaultEvidence(value: unknown, checkedAt: string): Evidence {
  return {
    kind: 'template_default',
    value,
    source_url: null,
    quote: null,
    rule_citation: null,
    checked_at: checkedAt,
  };
}

/**
 * A value a rules module computed, with its citation's proof; `checked_at` is the newest fixture
 * retrieval date at midnight UTC, or `now` when the state has no fixture (PIPE-confidence step 7).
 */
export function computedEvidence(
  value: unknown,
  c: Citation,
  checkedOn: string | null,
  now: Date,
): Evidence {
  return {
    kind: 'computed',
    value,
    source_url: c.sourceUrl,
    quote: c.quote,
    rule_citation: c.citation,
    checked_at: checkedOn === null ? now.toISOString() : `${checkedOn}T00:00:00.000Z`,
  };
}

/** A stage the merge takes owning values from, with no evidence kind of its own. */
export class EvidenceOriginError extends Error {
  override readonly name = 'EvidenceOriginError';

  constructor(origin: StageId) {
    super(`no evidence kind for the stage ${origin}`);
  }
}

function originKind(origin: StageId, meta: FieldMetaRow | undefined): EvidenceKind {
  switch (origin) {
    case 's01-base':
    case 's02-known':
    case 's02-coops':
    case 's09-people':
      return 'dataset';
    case 's04-expand':
      return meta !== undefined && meta.confidence !== 'low' ? 'statute' : 'template_default';
    case 's05-deadlines':
      return 'computed';
    case 's03-templates':
    case 's06-crawl':
    case 's06-extract':
    case 's07-results':
    case 's07-money':
    case 's08-filings':
    case 's10-bundle':
    case 's11-lean':
    case 's12-forms':
      throw new EvidenceOriginError(origin);
    default:
      return assertNever(origin);
  }
}

/**
 * The owning stage's own value as evidence for the writer's merge: `dataset` for the base load,
 * known bodies, co-ops and people; `statute` for a medium or high expand value and
 * `template_default` for a low one or one with no proof; `computed` for deadlines. The proof is the
 * row's `field_meta` entry, or nulls and the stage's finish time when it has none.
 */
export function metaToEvidence(
  table: Fact['table'],
  origin: StageId,
  value: unknown,
  meta: FieldMetaRow | undefined,
  stageFinishedAt: string,
): Evidence {
  return {
    kind: originKind(origin, meta),
    value,
    source_url: meta?.source_url ?? null,
    quote: meta?.quote ?? null,
    rule_citation: meta?.rule_citation ?? null,
    checked_at: meta?.checked_at ?? stageFinishedAt,
  };
}
