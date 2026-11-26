import { FieldMetaRowSchema } from '../bundle/common.ts';
import type { FieldMeta } from './common.ts';

// The one mapper from a stored field_meta entry to the wire FieldMeta (D-439): no other code
// reads the jsonb keys.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** FieldMeta from one stored field_meta entry; null when it does not parse as FieldMetaRow. */
export function toFieldMeta(row: unknown): FieldMeta | null {
  const parsed = FieldMetaRowSchema.safeParse(row);
  if (!parsed.success) {
    return null;
  }
  const stored = parsed.data;
  // population_source and population_year are not sent (D-439).
  return {
    sourceUrl: stored.source_url,
    quote: stored.quote,
    confidence: stored.confidence,
    checkedAt: stored.checked_at,
    ruleCitation: stored.rule_citation ?? null, // an absent optional key is a citation not stated
  };
}

/** The fieldMeta entries of one entity: one per pair whose value is not null and whose stored entry parses. `invalid` names the stored keys that did not parse. */
export function fieldMetaEntries<K extends string>(
  stored: unknown,
  pairs: ReadonlyArray<readonly [wireKey: K, storedKey: string, value: unknown]>,
): { entries: Partial<Record<K, FieldMeta>>; invalid: string[] } {
  const entries: Partial<Record<K, FieldMeta>> = {};
  const invalid: string[] = [];
  if (!isRecord(stored)) {
    return { entries, invalid };
  }
  for (const [wireKey, storedKey, value] of pairs) {
    // A null value has no entry, even when one is stored.
    if (value === null || value === undefined || !Object.hasOwn(stored, storedKey)) {
      continue;
    }
    const meta = toFieldMeta(stored[storedKey]);
    if (meta === null) {
      invalid.push(storedKey);
    } else {
      entries[wireKey] = meta;
    }
  }
  return { entries, invalid };
}
