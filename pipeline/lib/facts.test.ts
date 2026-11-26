import { FieldMetaRowSchema } from '@citizenrun/shared';
import type { FieldMetaRow } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import type { Evidence } from './confidence.ts';
import { FactSchema, UnknownFactFieldError, factKey, groupFacts, mergeFacts } from './facts.ts';
import type { Fact } from './facts.ts';

const NOW = new Date('2026-11-16T00:00:00.000Z');
const CHECKED = '2026-11-01T00:00:00.000Z';
const SITE = 'https://fixture-town.example.gov/';
const LISTING = 'https://www2.census.gov/programs-surveys/gus/fixture.xlsx';

type JurisdictionRow = {
  source_key: string;
  name: string;
  state: string;
  website: string | null;
  field_meta: Record<string, FieldMetaRow>;
};

const BASE_ROW: JurisdictionRow = {
  source_key: 'census:999999',
  name: 'Fixture Town',
  state: 'ZZ',
  website: SITE,
  field_meta: {
    name: {
      source_url: LISTING,
      quote: 'CENSUS_ID_PID6=999999',
      confidence: 'medium',
      checked_at: CHECKED,
    },
    website: {
      source_url: SITE,
      quote: 'WEB_ADDRESS=fixture-town.example.gov',
      confidence: 'medium',
      checked_at: CHECKED,
    },
  },
};

/** The base stage's own evidence for its row: the listing row's website, read on the site. */
function baseEvidence(row: JurisdictionRow, field: string): Evidence | null {
  if (field !== 'website' || row.website === null) return null;
  return {
    kind: 'dataset',
    value: row.website,
    source_url: SITE,
    quote: 'WEB_ADDRESS=fixture-town.example.gov',
    rule_citation: null,
    checked_at: CHECKED,
  };
}

function pageFact(value: string): Fact {
  return {
    table: 'jurisdictions',
    key: 'census:999999',
    field: 'website',
    value,
    evidence: {
      kind: 'page',
      value,
      source_url: SITE,
      quote: 'Welcome to Fixture Town',
      rule_citation: null,
      checked_at: '2026-11-10T00:00:00.000Z',
    },
    origin: 's02-coops',
  };
}

describe('facts', () => {
  it("a fact for a row merges with the owning stage's evidence", () => {
    const agreeing = pageFact(SITE);
    const merged = mergeFacts(
      'jurisdictions',
      [BASE_ROW],
      groupFacts([agreeing]),
      baseEvidence,
      NOW,
    );
    expect(merged.conflicts).toEqual([]);
    expect(merged.rows).toHaveLength(1);
    const row = merged.rows[0];
    expect(row?.website).toBe(SITE);
    // One source (the site's URL in both): medium, with the base stage's proof and the newest check.
    const meta = row?.field_meta['website'];
    expect(meta).toEqual({
      source_url: SITE,
      quote: 'WEB_ADDRESS=fixture-town.example.gov',
      confidence: 'medium',
      checked_at: '2026-11-10T00:00:00.000Z',
    });
    expect(FieldMetaRowSchema.parse(meta)).toEqual(meta);
    // A field without facts is left as the owning stage wrote it.
    expect(row?.field_meta['name']).toEqual(BASE_ROW.field_meta['name']);
    expect(row?.name).toBe('Fixture Town');

    const other = 'https://fixture-town-elsewhere.example.gov/';
    const disagreeing = pageFact(other);
    const withConflict = mergeFacts(
      'jurisdictions',
      [BASE_ROW],
      groupFacts([disagreeing]),
      baseEvidence,
      NOW,
    );
    expect(withConflict.rows[0]?.website).toBe(SITE);
    expect(withConflict.rows[0]?.field_meta['website']?.confidence).toBe('medium');
    expect(withConflict.conflicts).toEqual([
      { key: 'census:999999', field: 'website', evidence: [disagreeing.evidence] },
    ]);
    // The input row is not changed.
    expect(BASE_ROW.field_meta['website']?.checked_at).toBe(CHECKED);
  });

  it('a null winner removes the field_meta entry', () => {
    type TrackRow = {
      source_key: string;
      fee_cents: number | null;
      field_meta: Record<string, FieldMetaRow>;
    };
    const track: TrackRow = {
      source_key: 'zz-fixture-track',
      fee_cents: 5000,
      field_meta: {
        fee_cents: {
          source_url: 'https://fixture.example.gov/fees',
          quote: 'A fee of $50',
          confidence: 'low',
          checked_at: CHECKED,
        },
      },
    };
    // An act-on value with no https source anywhere reads "not known yet".
    const fact: Fact = {
      table: 'filing_tracks',
      key: 'zz-fixture-track',
      field: 'fee_cents',
      value: 5000,
      evidence: {
        kind: 'template_default',
        value: 5000,
        source_url: null,
        quote: null,
        rule_citation: null,
        checked_at: CHECKED,
      },
      origin: 's05-deadlines',
    };
    const merged = mergeFacts('filing_tracks', [track], groupFacts([fact]), () => null, NOW);
    expect(merged.rows[0]?.fee_cents).toBeNull();
    expect(merged.rows[0]?.field_meta).toEqual({});
    expect(merged.conflicts).toEqual([]);
  });

  it('only facts of the table and the row apply', () => {
    const elsewhere: Fact = { ...pageFact('https://x.example.gov/'), key: 'census:999998' };
    const otherTable: Fact = { ...pageFact('https://x.example.gov/'), table: 'districts' };
    const merged = mergeFacts(
      'jurisdictions',
      [BASE_ROW],
      groupFacts([elsewhere, otherTable]),
      baseEvidence,
      NOW,
    );
    expect(merged.rows[0]).toBe(BASE_ROW);
  });

  it('a fact for a column the row lacks throws', () => {
    const fact: Fact = { ...pageFact(SITE), field: 'motto' };
    expect(() =>
      mergeFacts('jurisdictions', [BASE_ROW], groupFacts([fact]), baseEvidence, NOW),
    ).toThrow(UnknownFactFieldError);
  });

  it('groups evidence by table, key and field', () => {
    const a = pageFact(SITE);
    const b = pageFact('https://b.example.gov/');
    expect(factKey(a)).toBe('jurisdictions|census:999999|website');
    expect(groupFacts([a, b])).toEqual(
      new Map([['jurisdictions|census:999999|website', [a.evidence, b.evidence]]]),
    );
  });

  it('FactSchema refuses an unknown table', () => {
    const fact = pageFact(SITE);
    expect(FactSchema.parse(fact)).toEqual(fact);
    expect(FactSchema.safeParse({ ...fact, table: 'people' }).success).toBe(false);
    expect(FactSchema.safeParse({ ...fact, field: 'Website' }).success).toBe(false);
    expect(FactSchema.safeParse({ ...fact, origin: 's99-none' }).success).toBe(false);
    expect(FactSchema.safeParse({ ...fact, extra: 1 }).success).toBe(false);
    expect(
      FactSchema.safeParse({ ...fact, evidence: { ...fact.evidence, kind: 'rumour' } }).success,
    ).toBe(false);
    expect(
      FactSchema.safeParse({
        ...fact,
        evidence: { ...fact.evidence, checked_at: '2026-11-10T00:00:00Z' },
      }).success,
    ).toBe(false);
    expect(FactSchema.safeParse({ ...fact, value: { a: 1 } }).success).toBe(false);
    expect(FactSchema.safeParse({ ...fact, value: ['a', 'b'] }).success).toBe(true);
  });
});
