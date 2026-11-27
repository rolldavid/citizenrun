import { createI18n } from '@citizenrun/shared';
import type { FieldMeta, TFunction } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';

import { presentSources, sourceDomain, sourceLine } from './present-sources';

// The typed t accepts catalog keys only; the presenter passes each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;
const ctx = { locale: 'en', now: new FakeClock('2026-11-15T17:00:00.000Z').now() };

// Every source here is invented: the pages of Fixture Wren County.
const BUDGET = 'https://www.wrencounty.example/budget-2026';
const FILING = 'https://elections.wrencounty.example/filing';

function proof(over: Partial<FieldMeta> = {}): FieldMeta {
  return {
    sourceUrl: BUDGET,
    quote: 'The treasurer is paid $62,000 a year.',
    confidence: 'high',
    checkedAt: '2026-11-09T15:00:00.000Z',
    ruleCitation: null,
    ...over,
  };
}

const LABELS = [
  { field: 'payAnnualCents', label: 'Pay' },
  { field: 'hoursPerWeek', label: 'Hours' },
  { field: 'filingDeadline', label: 'Filing deadline' },
];

describe('presentSources', () => {
  it('one entry per distinct link', () => {
    const entries = presentSources(
      {
        payAnnualCents: proof(),
        hoursPerWeek: proof({ quote: 'The office is full time.' }),
        filingDeadline: proof({ sourceUrl: FILING, quote: 'Filing closes November 27.' }),
      },
      LABELS,
      t,
      ctx,
    );
    expect(entries).toEqual([
      {
        id: BUDGET,
        covers: 'Pay and Hours',
        line: 'wrencounty.example. Checked Nov 9.',
        confidence: 'high',
        quote: 'The treasurer is paid $62,000 a year.',
        url: BUDGET,
        domain: 'wrencounty.example',
      },
      {
        id: FILING,
        covers: 'Filing deadline',
        line: 'elections.wrencounty.example. Checked Nov 9.',
        confidence: 'high',
        quote: 'Filing closes November 27.',
        url: FILING,
        domain: 'elections.wrencounty.example',
      },
    ]);
  });

  it('entries follow the order of the labels, not of the proofs', () => {
    const entries = presentSources(
      {
        payAnnualCents: proof(),
        filingDeadline: proof({ sourceUrl: FILING }),
        hoursPerWeek: proof(),
      },
      [LABELS[2], LABELS[1], LABELS[0]].flatMap((label) => (label === undefined ? [] : [label])),
      t,
      ctx,
    );
    expect(entries.map((entry) => entry.covers)).toEqual(['Filing deadline', 'Hours and Pay']);
  });

  it('the oldest check date', () => {
    const [entry] = presentSources(
      {
        payAnnualCents: proof({ checkedAt: '2026-11-09T15:00:00.000Z' }),
        hoursPerWeek: proof({ checkedAt: '2026-11-02T23:30:00.000Z' }),
      },
      LABELS,
      t,
      ctx,
    );
    expect(entry?.line).toBe('wrencounty.example. Checked Nov 2.');
    // The same whichever field comes first.
    const [swapped] = presentSources(
      {
        payAnnualCents: proof({ checkedAt: '2026-11-02T23:30:00.000Z' }),
        hoursPerWeek: proof({ checkedAt: '2026-11-09T15:00:00.000Z' }),
      },
      LABELS,
      t,
      ctx,
    );
    expect(swapped?.line).toBe('wrencounty.example. Checked Nov 2.');
  });

  it('a check in another year carries the year', () => {
    expect(sourceLine(proof({ checkedAt: '2025-12-30T08:00:00.000Z' }), t, ctx)).toBe(
      'wrencounty.example. Checked Dec 30, 2025.',
    );
    expect(() => sourceLine(proof({ checkedAt: 'last week' }), t, ctx)).toThrow(RangeError);
  });

  it('lowest confidence and first quote', () => {
    const [entry, ...others] = presentSources(
      {
        payAnnualCents: proof({ confidence: 'high', quote: null }),
        hoursPerWeek: proof({ confidence: 'low', quote: 'About 40 hours a week.' }),
        filingDeadline: proof({ confidence: 'medium', quote: 'Filing closes November 27.' }),
      },
      LABELS,
      t,
      ctx,
    );
    expect(others).toEqual([]);
    expect(entry?.confidence).toBe('low');
    // The first label with a quote gives it.
    expect(entry?.quote).toBe('About 40 hours a week.');
    expect(entry?.covers).toBe('Pay, Hours, and Filing deadline');

    const [medium] = presentSources(
      {
        payAnnualCents: proof({ confidence: 'medium' }),
        hoursPerWeek: proof({ confidence: 'high', quote: 'The office is full time.' }),
      },
      LABELS,
      t,
      ctx,
    );
    expect(medium?.confidence).toBe('medium');
    expect(medium?.quote).toBe('The treasurer is paid $62,000 a year.');
  });

  it('no link', () => {
    const unlinked = { sourceUrl: null, quote: null, confidence: 'low' } as const;
    const entries = presentSources(
      {
        payAnnualCents: proof(),
        hoursPerWeek: proof(unlinked),
        filingDeadline: proof({ ...unlinked, ruleCitation: 'Fixture Code 10-2' }),
      },
      LABELS,
      t,
      ctx,
    );
    // Two fields with no link are two entries: nothing says they share a source.
    expect(entries.map((entry) => entry.id)).toEqual([
      BUDGET,
      'field:hoursPerWeek',
      'field:filingDeadline',
    ]);
    expect(entries[1]).toEqual({
      id: 'field:hoursPerWeek',
      covers: 'Hours',
      line: 'No link to the source. Checked Nov 9.',
      confidence: 'low',
      quote: null,
      url: null,
      domain: null,
    });
    expect(entries[2]).toEqual({
      id: 'field:filingDeadline',
      covers: 'Filing deadline',
      line: 'Fixture Code 10-2. Checked Nov 9.',
      confidence: 'low',
      quote: null,
      url: null,
      domain: null,
    });
  });

  it('fields with no proof are skipped', () => {
    const entries = presentSources(
      { payAnnualCents: proof() },
      [...LABELS, { field: 'constructor', label: 'Not a field' }],
      t,
      ctx,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.covers).toBe('Pay');
    expect(presentSources({}, LABELS, t, ctx)).toEqual([]);
  });

  it("a card's sheet keeps pay and filing apart", () => {
    const fieldMeta = {
      payAnnualCents: proof(),
      hoursPerWeek: proof({ quote: 'The office is full time.' }),
      filingFeeCents: proof({ quote: 'The filing fee is $50.' }),
      filingDeadline: proof({ quote: 'Filing closes November 27.' }),
    };
    const labels = [
      LABELS[0] ?? { field: '', label: '' },
      { field: 'hoursPerWeek', label: 'Hours' },
      { field: 'filingFeeCents', label: 'Filing fee' },
      { field: 'filingDeadline', label: 'Filing deadline' },
    ];
    const canvasLines = [
      { field: 'pay', line: 'Pay: wrencounty.example, Nov 9.' },
      { field: 'filing', line: 'Filing: wrencounty.example, Nov 9.' },
      { field: 'votes', line: 'Votes: past election results.' },
    ] as const;
    const entries = presentSources(fieldMeta, labels, t, ctx, canvasLines);
    expect(entries.map(({ id, covers, line }) => ({ id, covers, line }))).toEqual([
      { id: 'field:payAnnualCents', covers: 'Pay', line: 'Pay: wrencounty.example, Nov 9.' },
      { id: BUDGET, covers: 'Hours and Filing fee', line: 'wrencounty.example. Checked Nov 9.' },
      {
        id: 'field:filingDeadline',
        covers: 'Filing deadline',
        line: 'Filing: wrencounty.example, Nov 9.',
      },
    ]);
    // Each keeps its own link and quote.
    expect(entries.map((entry) => entry.url)).toEqual([BUDGET, BUDGET, BUDGET]);
    expect(entries[2]?.quote).toBe('Filing closes November 27.');
    // Every id is its own, though the three share one link.
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);

    // A page section's sheet, with no canvas lines, has one entry for the one link.
    expect(presentSources(fieldMeta, labels, t, ctx)).toHaveLength(1);
  });

  it('on a card, pay stands on the per-period proof when there is no annual one', () => {
    const entries = presentSources(
      { payAmountCents: proof(), hoursPerWeek: proof() },
      [
        { field: 'payAmountCents', label: 'Pay' },
        { field: 'hoursPerWeek', label: 'Hours' },
      ],
      t,
      ctx,
      // The canvas printed no pay line: the entry stays apart and prints the page line.
      [],
    );
    expect(entries.map(({ id, line }) => ({ id, line }))).toEqual([
      { id: 'field:payAmountCents', line: 'wrencounty.example. Checked Nov 9.' },
      { id: BUDGET, line: 'wrencounty.example. Checked Nov 9.' },
    ]);
  });

  it('www is dropped and http is refused', () => {
    expect(sourceDomain('https://www.wrencounty.example/x')).toBe('wrencounty.example');
    expect(sourceDomain('http://x.example')).toBeNull();
    expect(sourceDomain(null)).toBeNull();
    expect(sourceDomain('not a link')).toBeNull();
    // Not shortened, and only one leading "www." goes.
    expect(sourceDomain('https://elections.co.wren.zz.example/a?b=c')).toBe(
      'elections.co.wren.zz.example',
    );
    expect(sourceDomain('https://www.www.wrencounty.example')).toBe('www.wrencounty.example');

    // A link that is refused is read as no link.
    const [entry] = presentSources(
      { payAnnualCents: proof({ sourceUrl: 'http://x.example', confidence: 'low' }) },
      LABELS,
      t,
      ctx,
    );
    expect(entry).toMatchObject({
      id: 'field:payAnnualCents',
      url: null,
      domain: null,
      line: 'No link to the source. Checked Nov 9.',
    });
  });
});
