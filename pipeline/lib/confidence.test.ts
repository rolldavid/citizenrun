import { FieldMetaRowSchema } from '@citizenrun/shared';
import type { FieldMetaRow } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import {
  ACT_ON_FIELDS,
  EVIDENCE_RANK,
  FRESHNESS_DAYS,
  ProofMissingError,
  canonicalJson,
  normaliseSourceUrl,
  resolve,
} from './confidence.ts';
import type { Evidence, EvidenceKind } from './confidence.ts';

const NOW = new Date('2026-11-16T00:00:00.000Z');
const CHECKED = '2026-11-01T00:00:00.000Z';

const CENSUS = 'https://www2.census.gov/a.xlsx';
const STATUTE = 'https://law.example.gov/s1';
const PAGE = 'https://town.example.gov/council';
const FEES = 'https://county.example.gov/fees.pdf';

function ev(
  kind: EvidenceKind,
  value: unknown,
  fields: Partial<Omit<Evidence, 'kind' | 'value'>> = {},
): Evidence {
  return {
    kind,
    value,
    source_url: null,
    quote: null,
    rule_citation: null,
    checked_at: CHECKED,
    ...fields,
  };
}

/** The meta is exactly `expected`, and it passes the stored-proof schema unchanged. */
function expectMeta(meta: FieldMetaRow | null, expected: FieldMetaRow): void {
  expect(meta).toEqual(expected);
  expect(FieldMetaRowSchema.parse(meta)).toEqual(expected);
}

/** mulberry32: a seeded order for the shuffle case. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

describe('the constants', () => {
  it('ranks the kinds as PIPE-confidence lists them', () => {
    expect(EVIDENCE_RANK).toEqual({
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
    expect(FRESHNESS_DAYS).toBe(180);
  });

  it('lists the twelve act-on columns', () => {
    expect([...ACT_ON_FIELDS].sort()).toEqual(
      [
        'closes_on',
        'closes_time',
        'fee_cents',
        'filing_fee_cents',
        'opens_on',
        'pay_amount_cents',
        'pay_annual_cents',
        'petition_due',
        'petition_opens',
        'signatures',
        'signatures_required',
        'where_to_file',
      ].sort(),
    );
  });
});

describe('canonicalJson and normaliseSourceUrl', () => {
  it('sorts object keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"y":2,"z":1}]},"b":1}',
    );
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('keeps scheme, host and path only', () => {
    expect(normaliseSourceUrl('HTTPS://Town.Example.GOV/Council/?a=1#top')).toBe(
      'https://town.example.gov/Council',
    );
    expect(normaliseSourceUrl('https://a.gov')).toBe('https://a.gov/');
    expect(normaliseSourceUrl('https://a.gov/')).toBe('https://a.gov/');
    expect(normaliseSourceUrl('https://a.gov/x//')).toBe('https://a.gov/x/');
  });
});

describe('resolve', () => {
  it('one dataset row is medium', () => {
    const result = resolve(
      'seats',
      [ev('dataset', 7, { source_url: CENSUS, quote: 'CENSUS_ID_PID6=999999' })],
      NOW,
    );
    expect(result.value).toBe(7);
    expect(result.conflict).toBeNull();
    expectMeta(result.meta, {
      source_url: CENSUS,
      quote: 'CENSUS_ID_PID6=999999',
      confidence: 'medium',
      checked_at: CHECKED,
    });
  });

  it('dataset plus an agreeing grounded template is high', () => {
    const result = resolve(
      'seats',
      [
        ev('statute', 7, { source_url: STATUTE, quote: 'shall consist of seven members' }),
        ev('dataset', 7, { source_url: CENSUS, quote: 'CENSUS_ID_PID6=999999' }),
      ],
      NOW,
    );
    expect(result.value).toBe(7);
    expectMeta(result.meta, {
      source_url: CENSUS,
      quote: 'CENSUS_ID_PID6=999999',
      confidence: 'high',
      checked_at: CHECKED,
    });
  });

  it('two passes on one page are medium', () => {
    const quote = 'The council has five members.';
    const result = resolve(
      'seats',
      [
        ev('page', 5, { source_url: PAGE, quote }),
        ev('page_two_pass', 5, { source_url: PAGE, quote }),
      ],
      NOW,
    );
    expectMeta(result.meta, { source_url: PAGE, quote, confidence: 'medium', checked_at: CHECKED });
  });

  it('two models agreeing on one page are medium', () => {
    const result = resolve(
      'seats',
      [
        ev('page', 5, { source_url: PAGE, quote: 'five members' }),
        ev('page', 5, {
          source_url: PAGE,
          quote: 'The council has five members.',
          checked_at: '2026-11-03T00:00:00.000Z',
        }),
      ],
      NOW,
    );
    // Proof from the newest check of the two equal ranks.
    expectMeta(result.meta, {
      source_url: PAGE,
      quote: 'The council has five members.',
      confidence: 'medium',
      checked_at: '2026-11-03T00:00:00.000Z',
    });
  });

  it('computed alone is medium', () => {
    const result = resolve(
      'closes_on',
      [
        ev('computed', '2027-12-17', {
          source_url: STATUTE,
          quote: 'no later than 12:00 noon on the third Friday in December',
          rule_citation: 'Fixture Code 1-2(a)',
        }),
      ],
      NOW,
    );
    expect(result.value).toBe('2027-12-17');
    expectMeta(result.meta, {
      source_url: STATUTE,
      quote: 'no later than 12:00 noon on the third Friday in December',
      confidence: 'medium',
      checked_at: CHECKED,
      rule_citation: 'Fixture Code 1-2(a)',
    });
  });

  it('computed plus a matching notice is high', () => {
    const notice = 'https://elections.example.gov/2027-calendar';
    const result = resolve(
      'closes_on',
      [
        ev('computed', '2027-12-17', {
          source_url: STATUTE,
          quote: 'the third Friday in December',
          rule_citation: 'Fixture Code 1-2(a)',
        }),
        ev('notice', '2027-12-17', {
          source_url: notice,
          quote: 'Filing closes December 17, 2027',
          checked_at: '2026-11-05T00:00:00.000Z',
        }),
      ],
      NOW,
    );
    expectMeta(result.meta, {
      source_url: notice,
      quote: 'Filing closes December 17, 2027',
      confidence: 'high',
      checked_at: '2026-11-05T00:00:00.000Z',
    });
  });

  it('a high value 181 days old is medium', () => {
    const checked = '2026-05-19T00:00:00.000Z';
    const result = resolve(
      'seats',
      [
        ev('dataset', 7, { source_url: CENSUS, quote: 'row', checked_at: checked }),
        ev('statute', 7, { source_url: STATUTE, quote: 'seven', checked_at: checked }),
      ],
      NOW,
    );
    expectMeta(result.meta, {
      source_url: CENSUS,
      quote: 'row',
      confidence: 'medium',
      checked_at: checked,
    });
  });

  it('a value checked exactly 180 days ago keeps its level', () => {
    const checked = '2026-05-20T00:00:00.000Z';
    const result = resolve(
      'seats',
      [
        ev('dataset', 7, { source_url: CENSUS, quote: 'row', checked_at: checked }),
        ev('statute', 7, { source_url: STATUTE, quote: 'seven', checked_at: checked }),
      ],
      NOW,
    );
    expectMeta(result.meta, {
      source_url: CENSUS,
      quote: 'row',
      confidence: 'high',
      checked_at: checked,
    });
  });

  it('a low value stays low when stale', () => {
    const checked = '2025-01-01T00:00:00.000Z';
    const result = resolve('seats', [ev('template_default', 5, { checked_at: checked })], NOW);
    expectMeta(result.meta, {
      source_url: null,
      quote: null,
      confidence: 'low',
      checked_at: checked,
    });
  });

  it('a medium value with a disagreeing grounded page is medium with a conflict', () => {
    const page = ev('page', 9, { source_url: PAGE, quote: 'nine members' });
    const result = resolve(
      'seats',
      [page, ev('dataset', 7, { source_url: CENSUS, quote: 'row' })],
      NOW,
    );
    expect(result.value).toBe(7);
    expect(result.conflict).toEqual([page]);
    expectMeta(result.meta, {
      source_url: CENSUS,
      quote: 'row',
      confidence: 'medium',
      checked_at: CHECKED,
    });
  });

  it('a high winner with a grounded conflict is capped at medium', () => {
    const page = ev('page', 9, { source_url: PAGE, quote: 'nine members' });
    const result = resolve(
      'seats',
      [
        ev('dataset', 7, { source_url: CENSUS, quote: 'row' }),
        page,
        ev('statute', 7, { source_url: STATUTE, quote: 'seven' }),
      ],
      NOW,
    );
    expect(result.value).toBe(7);
    expect(result.conflict).toEqual([page]);
    expectMeta(result.meta, {
      source_url: CENSUS,
      quote: 'row',
      confidence: 'medium',
      checked_at: CHECKED,
    });
  });

  it('a losing template default or estimate raises no conflict', () => {
    const result = resolve(
      'seats',
      [
        ev('dataset', 7, { source_url: CENSUS, quote: 'row' }),
        ev('statute', 7, { source_url: STATUTE, quote: 'seven' }),
        ev('template_default', 5),
        ev('estimate', 6),
      ],
      NOW,
    );
    expect(result.conflict).toBeNull();
    expect(result.meta?.confidence).toBe('high');
  });

  it('only a template default is low', () => {
    const result = resolve('seats', [ev('template_default', 5)], NOW);
    expect(result.value).toBe(5);
    expectMeta(result.meta, {
      source_url: null,
      quote: null,
      confidence: 'low',
      checked_at: CHECKED,
    });
  });

  it('an estimate is low', () => {
    const result = resolve('lean', [ev('estimate', 0.12)], NOW);
    expect(result.value).toBe(0.12);
    expectMeta(result.meta, {
      source_url: null,
      quote: null,
      confidence: 'low',
      checked_at: CHECKED,
    });
  });

  it('an ungrounded act-on value keeps its https source with a null quote', () => {
    const result = resolve(
      'filing_fee_cents',
      [ev('template_default', 5000, { source_url: FEES })],
      NOW,
    );
    expect(result.value).toBe(5000);
    expectMeta(result.meta, {
      source_url: FEES,
      quote: null,
      confidence: 'low',
      checked_at: CHECKED,
    });
  });

  it('an act-on value with no https source is null', () => {
    const evidence = [ev('template_default', 5000)];
    expect(resolve('filing_fee_cents', evidence, NOW)).toEqual({
      value: null,
      meta: null,
      conflict: null,
    });
    // An http address is not a source an act-on value may show.
    expect(
      resolve(
        'filing_fee_cents',
        [ev('template_default', 5000, { source_url: 'http://a.gov/f' })],
        NOW,
      ),
    ).toEqual({ value: null, meta: null, conflict: null });
    const notActOn = resolve('seats', [ev('template_default', 5)], NOW);
    expect(notActOn.value).toBe(5);
    expectMeta(notActOn.meta, {
      source_url: null,
      quote: null,
      confidence: 'low',
      checked_at: CHECKED,
    });
  });

  it('an act-on value with no https source still reports its conflict', () => {
    const scanned = ev('scanned', 7500, { source_url: null });
    const result = resolve(
      'filing_fee_cents',
      [ev('template_default', 5000), ev('template_default', 5000), scanned],
      NOW,
    );
    // The scanned value outranks the defaults and has no source either.
    expect(result).toEqual({ value: null, meta: null, conflict: null });
    const withLoser = resolve(
      'fee_cents',
      [
        ev('scanned', 7500, { source_url: null }),
        ev('scanned', 6000, { source_url: null, checked_at: '2026-10-01T00:00:00.000Z' }),
      ],
      NOW,
    );
    expect(withLoser.value).toBeNull();
    expect(withLoser.meta).toBeNull();
    expect(withLoser.conflict).toEqual([
      ev('scanned', 6000, { source_url: null, checked_at: '2026-10-01T00:00:00.000Z' }),
    ]);
  });

  it('a scanned act-on value keeps its https source with a null quote', () => {
    const result = resolve('filing_fee_cents', [ev('scanned', 5000, { source_url: FEES })], NOW);
    expect(result.value).toBe(5000);
    expectMeta(result.meta, {
      source_url: FEES,
      quote: null,
      confidence: 'low',
      checked_at: CHECKED,
    });
  });

  describe('TEST-confidence', () => {
    it('two agreeing sources is high', () => {
      const two = resolve(
        'seats',
        [
          ev('page', 5, { source_url: PAGE, quote: 'five members' }),
          ev('page', 5, { source_url: 'https://county.example.gov/boards', quote: 'five seats' }),
        ],
        NOW,
      );
      // Equal rank and check: the proof is the first in canonical byte order ("five m" < "five s").
      expectMeta(two.meta, {
        source_url: PAGE,
        quote: 'five members',
        confidence: 'high',
        checked_at: CHECKED,
      });
      const computed = resolve(
        'closes_on',
        [
          ev('computed', '2027-12-17', {
            source_url: STATUTE,
            quote: 'third Friday in December',
            rule_citation: 'Fixture Code 1-2(a)',
          }),
          ev('notice', '2027-12-17', {
            source_url: 'https://elections.example.gov/calendar',
            quote: 'December 17',
          }),
        ],
        NOW,
      );
      expectMeta(computed.meta, {
        source_url: 'https://elections.example.gov/calendar',
        quote: 'December 17',
        confidence: 'high',
        checked_at: CHECKED,
      });
    });

    it('two agreeing AI passes is medium', () => {
      const result = resolve(
        'pay_annual_cents',
        [
          ev('page', 1_200_000, { source_url: PAGE, quote: '$12,000 a year' }),
          ev('page_two_pass', 1_200_000, { source_url: `${PAGE}/`, quote: '$12,000 a year' }),
          ev('page', 1_200_000, { source_url: `${PAGE}?model=b`, quote: '$12,000 a year' }),
        ],
        NOW,
      );
      expect(result.meta?.confidence).toBe('medium');
      expectMeta(result.meta, {
        source_url: PAGE,
        quote: '$12,000 a year',
        confidence: 'medium',
        checked_at: CHECKED,
      });
    });

    it('one grounded source is medium', () => {
      const result = resolve(
        'seats',
        [ev('statute', 7, { source_url: STATUTE, quote: 'seven members' })],
        NOW,
      );
      expectMeta(result.meta, {
        source_url: STATUTE,
        quote: 'seven members',
        confidence: 'medium',
        checked_at: CHECKED,
      });
    });

    it('template default or estimate is low', () => {
      for (const kind of ['template_default', 'estimate'] as const) {
        const result = resolve('seats', [ev(kind, 5)], NOW);
        expectMeta(result.meta, {
          source_url: null,
          quote: null,
          confidence: 'low',
          checked_at: CHECKED,
        });
      }
    });

    it('freshness', () => {
      const medium = (checked: string) =>
        resolve(
          'seats',
          [ev('dataset', 7, { source_url: CENSUS, quote: 'row', checked_at: checked })],
          NOW,
        ).meta;
      expectMeta(medium('2026-05-20T00:00:00.000Z'), {
        source_url: CENSUS,
        quote: 'row',
        confidence: 'medium',
        checked_at: '2026-05-20T00:00:00.000Z',
      });
      expectMeta(medium('2026-05-19T00:00:00.000Z'), {
        source_url: CENSUS,
        quote: 'row',
        confidence: 'low',
        checked_at: '2026-05-19T00:00:00.000Z',
      });
      // One millisecond past 180 days drops the level; 180 days and 0 ms does not.
      expect(medium('2026-05-19T23:59:59.999Z')?.confidence).toBe('low');
      const low = resolve(
        'seats',
        [ev('template_default', 5, { checked_at: '2026-05-19T00:00:00.000Z' })],
        NOW,
      );
      expect(low.meta?.confidence).toBe('low');
    });

    it('a scanned PDF never drives a deadline alone', () => {
      const result = resolve('closes_on', [ev('scanned', '2027-12-17', { source_url: FEES })], NOW);
      expect(result.value).toBe('2027-12-17');
      expectMeta(result.meta, {
        source_url: FEES,
        quote: null,
        confidence: 'low',
        checked_at: CHECKED,
      });
    });
  });

  it('no evidence is null with no meta', () => {
    expect(resolve('seats', [], NOW)).toEqual({ value: null, meta: null, conflict: null });
  });

  it('input order does not change the result', () => {
    const evidence = [
      ev('dataset', 7, { source_url: CENSUS, quote: 'row' }),
      ev('page', 7, { source_url: PAGE, quote: 'seven', checked_at: '2026-11-02T00:00:00.000Z' }),
      ev('page_two_pass', 7, { source_url: PAGE, quote: 'seven members' }),
      ev('page', 9, { source_url: 'https://other.example.gov/a', quote: 'nine' }),
      ev('scanned', 8, { source_url: FEES }),
      ev('template_default', 5),
      ev('statute', { b: 1, a: 2 }, { source_url: STATUTE, quote: 'x' }),
      ev('statute', { a: 2, b: 1 }, { source_url: 'https://law.example.gov/s2', quote: 'y' }),
    ];
    const expected = resolve('seats', evidence, NOW);
    const random = seeded(20261116);
    for (let i = 0; i < 25; i += 1) {
      expect(resolve('seats', shuffled(evidence, random), NOW)).toEqual(expected);
    }
    // 7 wins on the dataset's rank with two sources (high), capped at medium by three grounded
    // losing groups: the statute pair (one object in two key orders), the page's 9 and the scan's 8.
    expect(expected.value).toBe(7);
    expectMeta(expected.meta, {
      source_url: CENSUS,
      quote: 'row',
      confidence: 'medium',
      checked_at: '2026-11-02T00:00:00.000Z',
    });
    expect(expected.conflict?.map((item) => [item.kind, item.value])).toEqual([
      ['statute', { a: 2, b: 1 }],
      ['statute', { b: 1, a: 2 }],
      ['page', 9],
      ['scanned', 8],
    ]);
  });

  it('two URLs differing only by query count once', () => {
    const result = resolve(
      'seats',
      [
        ev('dataset', 7, { source_url: 'https://a.gov/x?y=1', quote: 'row' }),
        ev('page', 7, { source_url: 'https://a.gov/x', quote: 'seven' }),
      ],
      NOW,
    );
    expectMeta(result.meta, {
      source_url: 'https://a.gov/x?y=1',
      quote: 'row',
      confidence: 'medium',
      checked_at: CHECKED,
    });
  });

  it('a medium result without a quote throws ProofMissingError', () => {
    expect(() => resolve('seats', [ev('dataset', 7, { source_url: CENSUS })], NOW)).toThrow(
      ProofMissingError,
    );
    expect(() =>
      resolve('pay_annual_cents', [ev('dataset', 1_200_000, { source_url: CENSUS })], NOW),
    ).toThrow(ProofMissingError);
  });
});
