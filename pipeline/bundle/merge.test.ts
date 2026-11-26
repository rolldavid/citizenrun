import type { MeetingTime } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import type { Evidence } from '../lib/confidence.ts';
import type { Fact } from '../lib/facts.ts';
import { emptyRows } from './assemble.ts';
import type { AssembledRows, OriginIndex } from './assemble.ts';
import {
  applyFreshness,
  applyPlausibility,
  deriveFitsDayJob,
  freshenRows,
  mergeFacts,
} from './merge.ts';
import { FIXTURE_URL, election, office, officeRef, proof, track } from './testing/rows.ts';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const DAY = 86_400_000;
const TODAY = '2026-11-26';
const SLUG = 'zz-fixture-county-board-of-commissioners';

function ago(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

function rowsWith(extra: Partial<AssembledRows>): AssembledRows {
  return { ...emptyRows(), ...extra };
}

function fact(field: string, value: number, evidence: Partial<Evidence> = {}): Fact {
  return {
    table: 'offices',
    key: SLUG,
    field,
    value,
    origin: 's05-deadlines',
    evidence: {
      kind: 'computed',
      value,
      source_url: 'https://example.test/zz/code',
      quote: 'The filing fee is one percent of the annual salary.',
      rule_citation: 'Fixture Code 1-2',
      checked_at: ago(10),
      ...evidence,
    },
  };
}

const ORIGINS: OriginIndex = new Map([
  [`offices|${SLUG}`, { origin: 's04-expand', finishedAt: ago(1) }],
]);

describe('mergeFacts', () => {
  it("a stage 5 fact fills the office's fee with computed proof", () => {
    const rows = rowsWith({ offices: [office(SLUG)] });
    const out = mergeFacts(rows, [fact('filing_fee_cents', 45_000)], ORIGINS, NOW);
    const merged = out.rows.offices[0];
    expect(merged?.filing_fee_cents).toBe(45_000);
    expect(merged?.field_meta['filing_fee_cents']).toEqual({
      source_url: 'https://example.test/zz/code',
      quote: 'The filing fee is one percent of the annual salary.',
      confidence: 'medium',
      checked_at: ago(10),
      rule_citation: 'Fixture Code 1-2',
    });
    expect(out.conflicts).toBe(0);
  });

  it('a fact disagreeing with a grounded owning value is a conflict capped at medium', () => {
    const owning = office(SLUG, {
      filing_fee_cents: 10_000,
      field_meta: { filing_fee_cents: proof({ source_url: FIXTURE_URL, checked_at: ago(5) }) },
    });
    const agreeing = fact('filing_fee_cents', 10_000, { rule_citation: 'Fixture Code 1-1' });
    const disagreeing = fact('filing_fee_cents', 45_000, { rule_citation: 'Fixture Code 9-9' });
    // Without the disagreeing fact, the statute value and the computed value are two sources: high.
    const agreed = mergeFacts(rowsWith({ offices: [owning] }), [agreeing], ORIGINS, NOW);
    expect(agreed.rows.offices[0]?.field_meta['filing_fee_cents']?.confidence).toBe('high');
    const out = mergeFacts(rowsWith({ offices: [owning] }), [agreeing, disagreeing], ORIGINS, NOW);
    expect(out.rows.offices[0]?.filing_fee_cents).toBe(10_000);
    expect(out.rows.offices[0]?.field_meta['filing_fee_cents']?.confidence).toBe('medium');
    expect(out.conflicts).toBe(1);
  });

  it('leaves rows without facts unchanged', () => {
    const rows = rowsWith({ offices: [office('zz-other', { title: 'Other' })] });
    expect(mergeFacts(rows, [fact('filing_fee_cents', 1)], ORIGINS, NOW).rows.offices).toEqual(
      rows.offices,
    );
  });
});

describe('freshness', () => {
  it('a medium value checked 181 days ago becomes low; 180 days stays medium', () => {
    expect(applyFreshness(proof({ checked_at: ago(181) }), NOW).confidence).toBe('low');
    expect(applyFreshness(proof({ checked_at: ago(180) }), NOW).confidence).toBe('medium');
  });

  it('a high value becomes medium once, not twice', () => {
    const high = proof({ confidence: 'high', checked_at: ago(400) });
    expect(applyFreshness(high, NOW).confidence).toBe('medium');
    const rows = rowsWith({
      offices: [office(SLUG, { term_years: 4, field_meta: { term_years: high } })],
    });
    const fresh = freshenRows(rows, [], NOW);
    expect(fresh.offices[0]?.field_meta['term_years']?.confidence).toBe('medium');
  });

  it("skips the fields the merge produced and drops stale tracks' and powers' own levels", () => {
    const stale = proof({ checked_at: ago(200) });
    const rows = rowsWith({
      offices: [
        office(SLUG, {
          filing_fee_cents: 1,
          term_years: 4,
          field_meta: { filing_fee_cents: stale, term_years: stale },
        }),
      ],
      filing_tracks: [track(`${SLUG}|2027-11-02|general|`, { checked_at: ago(200) })],
    });
    const fresh = freshenRows(rows, [fact('filing_fee_cents', 1)], NOW);
    expect(fresh.offices[0]?.field_meta['filing_fee_cents']?.confidence).toBe('medium');
    expect(fresh.offices[0]?.field_meta['term_years']?.confidence).toBe('low');
    expect(fresh.filing_tracks[0]?.confidence).toBe('low');
  });
});

describe('deriveFitsDayJob', () => {
  type Row = [boolean | null, number | null, MeetingTime[] | null, 'yes' | 'likely' | 'no' | null];
  it.each<Row>([
    [true, 10, ['evenings'], 'no'],
    [null, 35, null, 'no'],
    [false, 15, ['daytime', 'evenings'], 'no'],
    [null, 8, ['daytime'], 'likely'],
    [null, null, ['daytime'], 'no'],
    [null, null, null, null],
    [false, 12, ['evenings', 'weekends'], 'yes'],
    [null, 25, ['evenings'], 'likely'],
    [false, null, null, 'likely'],
    [null, null, [], 'likely'],
  ])(
    "fits_day_job follows 05's table: %s, %s, %j gives %s",
    (fullTime, hours, meetings, expected) => {
      const derived = deriveFitsDayJob(
        office(SLUG, {
          full_time: fullTime,
          hours_per_week: hours,
          meeting_times: meetings,
          fits_day_job: 'yes',
        }),
      );
      expect(derived.fits_day_job).toBe(expected);
    },
  );
});

describe('applyPlausibility', () => {
  it('an annual pay above the plausible limit is dropped with its proof', () => {
    const rows = rowsWith({
      offices: [
        office(SLUG, {
          pay_annual_cents: 60_000_000,
          term_years: 4,
          field_meta: { pay_annual_cents: proof(), term_years: proof() },
        }),
      ],
    });
    const out = applyPlausibility(rows, new Map(), TODAY);
    expect(out.rows.offices[0]?.pay_annual_cents).toBeNull();
    expect(out.rows.offices[0]?.field_meta).toEqual({ term_years: proof() });
    expect(out.dropped).toEqual({ 'plausibility_dropped:pay_annual': 1 });
  });

  it("pay within the template's pay_range is kept", () => {
    const rows = rowsWith({
      offices: [
        office(SLUG, { pay_annual_cents: 60_000_000, field_meta: { pay_annual_cents: proof() } }),
      ],
    });
    const refs = new Map([
      [SLUG, officeRef(SLUG, { pay_range: { min_cents: 0, max_cents: 70_000_000 } })],
    ]);
    const out = applyPlausibility(rows, refs, TODAY);
    expect(out.rows.offices[0]?.pay_annual_cents).toBe(60_000_000);
    expect(out.dropped).toEqual({});
  });

  it('signatures of 0 pass', () => {
    const key = `${SLUG}|2027-11-02|general|`;
    const rows = rowsWith({
      offices: [
        office(SLUG, { signatures_required: 0, field_meta: { signatures_required: proof() } }),
      ],
      elections: [election(SLUG, '2027-11-02')],
      filing_tracks: [track(key, { signatures: 0 })],
    });
    const out = applyPlausibility(rows, new Map(), TODAY);
    expect(out.rows.offices[0]?.signatures_required).toBe(0);
    expect(out.rows.filing_tracks[0]?.signatures).toBe(0);
    expect(out.dropped).toEqual({});
  });

  it('a seat count of 0 drops the office with its elections and tracks', () => {
    const key = `${SLUG}|2027-11-02|general|`;
    const rows = rowsWith({
      offices: [office(SLUG, { seats: 0 }), office('zz-kept')],
      elections: [election(SLUG, '2027-11-02'), election('zz-kept', '2027-11-02')],
      filing_tracks: [track(key), track('zz-kept|2027-11-02|general|')],
    });
    const out = applyPlausibility(rows, new Map(), TODAY);
    expect(out.rows.offices.map((o) => o.source_key)).toEqual(['zz-kept']);
    expect(out.rows.elections.map((e) => e.office_key)).toEqual(['zz-kept']);
    expect(out.rows.filing_tracks.map((t) => t.election_key)).toEqual([
      'zz-kept|2027-11-02|general|',
    ]);
    expect(out.dropped).toEqual({ office_implausible: 1 });
  });

  it('an election more than five years away is dropped with its tracks', () => {
    const key = `${SLUG}|2032-11-02|general|`;
    const rows = rowsWith({
      offices: [office(SLUG)],
      elections: [election(SLUG, '2032-11-02')],
      filing_tracks: [track(key)],
    });
    const out = applyPlausibility(rows, new Map(), TODAY);
    expect(out.rows.elections).toEqual([]);
    expect(out.rows.filing_tracks).toEqual([]);
    expect(out.dropped).toEqual({ 'plausibility_dropped:date_in_range': 1 });
  });

  it('a track closing after its election loses that date and its hour', () => {
    const key = `${SLUG}|2027-11-02|general|`;
    const rows = rowsWith({
      offices: [office(SLUG)],
      elections: [election(SLUG, '2027-11-02')],
      filing_tracks: [
        track(key, {
          closes_on: '2027-11-05',
          closes_time: '17:00',
          field_meta: { closes_on: proof(), closes_time: proof() },
        }),
      ],
    });
    const out = applyPlausibility(rows, new Map(), TODAY);
    expect(out.rows.filing_tracks[0]).toMatchObject({
      closes_on: null,
      closes_time: null,
      field_meta: {},
    });
    expect(out.dropped).toEqual({ 'plausibility_dropped:closes_before_election': 1 });
  });
});
