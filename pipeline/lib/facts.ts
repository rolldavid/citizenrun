import { IsoInstantSchema, SourceKeySchema } from '@citizenrun/shared';
import type { FieldMetaRow } from '@citizenrun/shared';
import { z } from 'zod';
import { EVIDENCE_KINDS, resolve } from './confidence.ts';
import type { Evidence } from './confidence.ts';
import { StageMetaSchema } from './runner.ts';
import type { StageId } from './runner.ts';

/** A value one stage contributes to a row another stage owns. */
export type Fact = {
  table:
    | 'offices'
    | 'elections'
    | 'filing_tracks'
    | 'jurisdictions'
    | 'districts'
    | 'officeholders'
    | 'office_powers';
  key: string; // the row's source_key
  field: string; // snake_case column name (02)
  value: string | number | boolean | string[] | null; // canonical form (PIPE-grounding step 6)
  evidence: Evidence; // PIPE-confidence input
  origin: StageId;
};

export const FACT_TABLES = [
  'offices',
  'elections',
  'filing_tracks',
  'jurisdictions',
  'districts',
  'officeholders',
  'office_powers',
] as const satisfies readonly Fact['table'][];

const EvidenceSchema = z.strictObject({
  kind: z.enum(EVIDENCE_KINDS),
  value: z.unknown(),
  source_url: z.string().nullable(),
  quote: z.string().nullable(),
  rule_citation: z.string().nullable(),
  checked_at: IsoInstantSchema,
});

/** One line of a stage's `facts` file. */
export const FactSchema = z.strictObject({
  table: z.enum(FACT_TABLES),
  key: SourceKeySchema,
  field: z.string().regex(/^[a-z][a-z0-9_]*$/),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  evidence: EvidenceSchema,
  origin: StageMetaSchema.shape.stage,
});

/** `<table>|<key>|<field>`. */
export function factKey(f: Pick<Fact, 'table' | 'key' | 'field'>): string {
  return `${f.table}|${f.key}|${f.field}`;
}

/** The evidence of every fact, grouped by `factKey`, in input order. */
export function groupFacts(facts: Iterable<Fact>): ReadonlyMap<string, readonly Evidence[]> {
  const out = new Map<string, Evidence[]>();
  for (const fact of facts) {
    const key = factKey(fact);
    const list = out.get(key);
    if (list === undefined) {
      out.set(key, [fact.evidence]);
    } else {
      list.push(fact.evidence);
    }
  }
  return out;
}

/** A fact names a column the row does not have: a bug in the stage that wrote it. */
export class UnknownFactFieldError extends Error {
  override readonly name = 'UnknownFactFieldError';

  constructor(table: string, field: string) {
    super(`a fact for ${table} names the column ${field}, which the row does not have`);
  }
}

/** The fields with facts for each `<table>|<key>` prefix; a field name never holds `|`. */
function fieldsByRow(facts: ReadonlyMap<string, readonly Evidence[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of facts.keys()) {
    const cut = key.lastIndexOf('|');
    const prefix = key.slice(0, cut);
    const field = key.slice(cut + 1);
    const list = out.get(prefix);
    if (list === undefined) {
      out.set(prefix, [field]);
    } else {
      list.push(field);
    }
  }
  return out;
}

/**
 * For each row and each field that has facts, resolves the owning stage's evidence together with
 * the facts (PIPE-confidence), writes the winning value and its proof, and removes the proof when
 * the value is null. Rows come back in input order, each row with facts as a changed copy; the
 * inputs are not changed.
 */
export function mergeFacts<
  Row extends { source_key: string; field_meta: Record<string, FieldMetaRow> },
>(
  table: Fact['table'],
  rows: readonly Row[],
  facts: ReadonlyMap<string, readonly Evidence[]>,
  ownEvidence: (row: Row, field: string) => Evidence | null,
  now: Date,
): { rows: Row[]; conflicts: { key: string; field: string; evidence: Evidence[] }[] } {
  const fields = fieldsByRow(facts);
  const conflicts: { key: string; field: string; evidence: Evidence[] }[] = [];
  const out = rows.map((row) => {
    const rowFields = fields.get(`${table}|${row.source_key}`);
    if (rowFields === undefined) {
      return row;
    }
    const merged: Record<string, unknown> = { ...row };
    const fieldMeta: Record<string, FieldMetaRow> = { ...row.field_meta };
    for (const field of [...rowFields].sort()) {
      if (!Object.hasOwn(row, field) || field === 'source_key' || field === 'field_meta') {
        throw new UnknownFactFieldError(table, field);
      }
      const own = ownEvidence(row, field);
      const factEvidence = facts.get(factKey({ table, key: row.source_key, field })) ?? [];
      const result = resolve(field, own === null ? factEvidence : [own, ...factEvidence], now);
      if (result.value === null || result.meta === null) {
        merged[field] = null;
        Reflect.deleteProperty(fieldMeta, field);
      } else {
        merged[field] = result.value;
        fieldMeta[field] = result.meta;
      }
      if (result.conflict !== null) {
        conflicts.push({ key: row.source_key, field, evidence: result.conflict });
      }
    }
    merged['field_meta'] = fieldMeta;
    return merged as unknown as Row;
  });
  return { rows: out, conflicts };
}
