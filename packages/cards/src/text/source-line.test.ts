import { describe, expect, it } from 'vitest';
import { createI18n } from '@citizenrun/shared';
import type { FieldMeta, OfficeSummary, TFunction } from '@citizenrun/shared';
import type { CardContext } from '../feed.ts';
import { checkedDate, officeSourceLines, publisherOf } from './source-line.ts';

// The typed t accepts catalog keys only; the functions under test pass each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;
const ctx: CardContext = { locale: 'en', now: new Date('2026-11-15T17:00:00Z') };
const CHECKED = '2026-11-09T15:00:00.000Z';

function proof(overrides: Partial<FieldMeta> = {}): FieldMeta {
  return {
    sourceUrl: 'https://elections.wrencounty.example/budget',
    quote: 'Fixture quote.',
    confidence: 'high',
    checkedAt: CHECKED,
    ruleCitation: null,
    ...overrides,
  };
}

/** A fixture office of Fixture Wren County, ZZ, with no pay, no deadline and no vote count. */
function office(overrides: Partial<OfficeSummary> = {}): OfficeSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'fixture-wren-county-treasurer',
    title: 'County Treasurer',
    officeTypeId: 'county-treasurer',
    level: 'county',
    electorate: 'public',
    state: 'ZZ',
    jurisdiction: {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Fixture Wren County',
      kind: 'county',
      state: 'ZZ',
      website: 'https://wrencounty.example/',
      timezone: null,
    },
    district: {
      id: '00000000-0000-4000-8000-000000000003',
      tileId: 1,
      name: 'Fixture Wren County',
      level: 'county',
      geometryQuality: 'exact',
    },
    outline: null,
    placeholder: false,
    completeness: null,
    partisan: null,
    seats: 1,
    bodySize: null,
    seatsUpNext: null,
    payAnnualCents: null,
    payKind: null,
    payAmountCents: null,
    payPeriod: null,
    hoursPerWeek: null,
    fitsDayJob: null,
    fullTime: null,
    signaturesRequired: null,
    filingFeeCents: null,
    costToRunCents: null,
    ease: null,
    easeConfidence: null,
    impact: null,
    impactMode: 'personal',
    impactIssueId: null,
    opportunity: null,
    votesToWin: null,
    votesLow: null,
    votesHigh: null,
    votesEstimated: null,
    nextElection: null,
    filingDeadline: null,
    filingStatus: 'dates_not_known',
    headlineIssueId: null,
    issues: [],
    featuredOfficeholder: null,
    featuredHolderSince: null,
    openSeat: null,
    fieldMeta: {},
    retiredAt: null,
    viewer: { following: false, bookmarked: false, running: false, declarationId: null },
    ...overrides,
  };
}

const DEADLINE = { date: '2027-02-27', time: null, timezone: null };

describe('publisherOf', () => {
  it('publisher abbreviation', () => {
    expect(publisherOf('https://elections.wrencounty.gov/x', 20)).toBe('wrencounty.gov');
    expect(publisherOf('https://www.co.wren.nc.us/x', 12)).toBe('wren.nc.us');
  });

  it('publisher refuses and cuts', () => {
    expect(publisherOf('http://wrencounty.example/x', 39)).toBeNull();
    expect(publisherOf(null, 39)).toBeNull();
    expect(publisherOf('not a link', 39)).toBeNull();
    expect(publisherOf('https://elections.wrencounty.example/a', 10)).toBe('wrencount…');
    expect(publisherOf('https://elections.wrencounty.example/a', 1)).toBe('…');
  });

  it('keeps the whole host when it fits', () => {
    expect(publisherOf('https://www.elections.wrencounty.example/a', 39)).toBe(
      'elections.wrencounty.example',
    );
    expect(publisherOf('https://WrenCounty.Example/a', 39)).toBe('wrencounty.example');
  });
});

describe('checkedDate', () => {
  it('checked date with and without the year', () => {
    expect(checkedDate('2026-11-09T15:00:00Z', ctx)).toBe('Nov 9');
    expect(
      checkedDate('2026-11-09T15:00:00Z', { ...ctx, now: new Date('2027-01-05T12:00:00Z') }),
    ).toBe('Nov 9, 2026');
  });

  it('refuses a string that is no instant', () => {
    expect(() => checkedDate('yesterday', ctx)).toThrow(RangeError);
  });
});

describe('officeSourceLines', () => {
  it('pay and filing lines', () => {
    const lines = officeSourceLines(
      office({
        payAnnualCents: 5290000,
        payKind: 'salary',
        filingDeadline: DEADLINE,
        fieldMeta: { payAnnualCents: proof(), filingDeadline: proof({ confidence: 'medium' }) },
      }),
      t,
      ctx,
    );
    expect(lines).toEqual([
      { field: 'pay', line: 'Pay: wrencounty.example, Nov 9.' },
      { field: 'filing', line: 'Filing: wrencounty.example, Nov 9.' },
    ]);
    for (const { line } of lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(39);
    }
  });

  it('takes the pay amount proof when the annual one is missing', () => {
    const lines = officeSourceLines(
      office({
        payKind: 'per_meeting',
        payAmountCents: 15000,
        payPeriod: 'meeting',
        fieldMeta: { payAmountCents: proof() },
      }),
      t,
      ctx,
    );
    expect(lines).toEqual([{ field: 'pay', line: 'Pay: wrencounty.example, Nov 9.' }]);
  });

  it('low proof lines', () => {
    const low = proof({ confidence: 'low', sourceUrl: null, quote: null });
    const lines = officeSourceLines(
      office({
        payAnnualCents: 5290000,
        filingDeadline: DEADLINE,
        fieldMeta: { payAnnualCents: low, filingDeadline: low },
      }),
      t,
      ctx,
    );
    expect(lines).toEqual([
      { field: 'pay', line: 'Pay: low confidence, Nov 9.' },
      { field: 'filing', line: 'Filing: low confidence, Nov 9.' },
    ]);
  });

  it('a low proof with a link still says low confidence', () => {
    const lines = officeSourceLines(
      office({ payKind: 'none', fieldMeta: { payAnnualCents: proof({ confidence: 'low' }) } }),
      t,
      ctx,
    );
    expect(lines).toEqual([{ field: 'pay', line: 'Pay: low confidence, Nov 9.' }]);
  });

  it('votes lines', () => {
    const base = {
      payAnnualCents: 5290000,
      filingDeadline: DEADLINE,
      fieldMeta: { payAnnualCents: proof(), filingDeadline: proof() },
      votesToWin: 2100,
    };
    const estimate = officeSourceLines(office({ ...base, votesEstimated: true }), t, ctx);
    expect(estimate.map((item) => item.field)).toEqual(['pay', 'filing', 'votes']);
    expect(estimate[2]).toEqual({ field: 'votes', line: 'Votes: estimate from population.' });
    const results = officeSourceLines(office({ ...base, votesEstimated: false }), t, ctx);
    expect(results[2]).toEqual({ field: 'votes', line: 'Votes: past election results.' });
    const unknown = officeSourceLines(office({ ...base, votesEstimated: null }), t, ctx);
    expect(unknown.map((item) => item.field)).toEqual(['pay', 'filing']);
  });

  it('no proof, no line', () => {
    expect(
      officeSourceLines(office({ payAnnualCents: 5290000, payKind: 'salary' }), t, ctx),
    ).toEqual([]);
    expect(
      officeSourceLines(
        office({ filingDeadline: null, fieldMeta: { filingDeadline: proof() } }),
        t,
        ctx,
      ),
    ).toEqual([]);
    expect(officeSourceLines(office({ fieldMeta: { payAnnualCents: proof() } }), t, ctx)).toEqual(
      [],
    );
  });

  it('the date is never cut', () => {
    const host = `${'a'.repeat(52)}.example`;
    expect(host).toHaveLength(60);
    const [pay] = officeSourceLines(
      office({
        payAnnualCents: 5290000,
        fieldMeta: { payAnnualCents: proof({ sourceUrl: `https://${host}/budget` }) },
      }),
      t,
      { ...ctx, now: new Date('2026-12-31T23:00:00Z') },
    );
    expect(pay?.field).toBe('pay');
    const line = pay?.line ?? '';
    expect(Array.from(line).length).toBeLessThanOrEqual(39);
    expect(line.endsWith(', Nov 9.')).toBe(true);
    expect(line).toContain('…');
  });
});
