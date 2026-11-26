import { describe, expect, it } from 'vitest';
import { assemble } from './assemble.ts';
import { CoverageStatsSchema, coverageStats } from './coverage.ts';
import type { CoverageInput } from './coverage.ts';
import type { BundleInputs, StateInputs } from './inputs.ts';
import {
  district,
  election,
  jurisdiction,
  office,
  proof,
  stageMeta,
  stateInputs,
  track,
} from './testing/rows.ts';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const VERSION = '20261126T120000Z-full';

/** A ZZ state with hand-countable rows. */
function zz(): StateInputs {
  return stateInputs({
    base: {
      meta: stageMeta('s01-base', 'ZZ', {
        checks: [{ name: 'join_rate', passed: true, detail: 'county=1000' }],
      }),
      jurisdictions: [
        jurisdiction('state:ZZ', { kind: 'state' }),
        jurisdiction('census:990001', { kind: 'county', website: 'https://example.test/c' }),
        jurisdiction('census:990002', { kind: 'city' }),
        jurisdiction('census:990003', { kind: 'special_district' }),
        jurisdiction('census:990004', { kind: 'special_district' }),
      ],
      districts: [
        district('tiger:state:99'),
        district('tiger:county:99001'),
        district('county_approx:census:990003', { geometry_quality: 'county_approx' }),
        district('parent_fallback:census:990002:all', { geometry_quality: 'parent_fallback' }),
      ],
      coverage: [
        { name: 'dataset_needs_seed:school-finance', value: 1 },
        { name: 'units_with_website', value: 9 },
        { name: 'website_invalid', value: 2 },
        { name: 'website_unchecked', value: 4 },
        { name: 'districts:exact', value: 2 },
      ],
    },
    known: {
      meta: stageMeta('s02-known', 'ZZ', {
        checks: [
          { name: 'slug_unique', passed: true, detail: 'failures=0' },
          { name: 'known', passed: true, detail: 'legislators=3 legislator_unmapped=1' },
        ],
      }),
    },
    expand: {
      meta: stageMeta('s04-expand'),
      offices: [
        office('zz-commission', {
          pay_annual_cents: 100,
          filing_fee_cents: 1,
          field_meta: {
            pay_annual_cents: proof(),
            filing_fee_cents: proof({ confidence: 'high' }),
          },
        }),
        office('zz-commission-2', {
          pay_amount_cents: 5,
          field_meta: { pay_amount_cents: proof({ confidence: 'low' }) },
        }),
        office('zz-placeholder', { office_type_id: 'school-board', placeholder: true }),
      ],
      elections: [
        election('zz-commission', '2027-11-02'),
        election('zz-commission-2', '2025-11-04'),
      ],
    },
    deadlines: {
      meta: stageMeta('s05-deadlines'),
      filing_tracks: [
        track('zz-commission|2027-11-02|general|', { closes_on: '2027-08-01' }),
        track('zz-commission-2|2025-11-04|general|', { closes_on: '2025-08-01' }),
      ],
    },
  });
}

function bundleInputs(states: StateInputs[], extra: Partial<BundleInputs> = {}): BundleInputs {
  return {
    states,
    missing: [],
    zipCentroids: [],
    zipMeta: null,
    givenNameAliases: [],
    givenNameMeta: null,
    listingWebsites: new Map([['99', 3]]),
    boundarySources: [],
    ...extra,
  };
}

function input(inputs: BundleInputs, extra: Partial<CoverageInput> = {}): CoverageInput {
  const assembled = assemble(inputs);
  return {
    version: VERSION,
    now: NOW,
    today: '2026-11-26',
    inputs,
    states: assembled.states.map((s) => ({
      state: s.state,
      rows: s.rows,
      counts: { ...s.counts, 'plausibility_dropped:pay_annual': 2 },
    })),
    templateStates: new Set(),
    rules: new Map(),
    blockingChecks: { 's02-known': ['slug_unique'] },
    ...extra,
  };
}

describe('coverageStats', () => {
  it('counts the ZZ assembly by hand', () => {
    const stats = coverageStats(input(bundleInputs([zz()])));
    expect(CoverageStatsSchema.parse(stats)).toEqual(stats);
    const zzStats = stats.states['ZZ'];
    expect(zzStats?.units).toEqual({
      county: 1,
      city: 1,
      township: 0,
      school_district: 0,
      special_district: 2,
      coop: 0,
      party: 0,
    });
    expect(zzStats?.units_with_website).toBe(3);
    expect(zzStats?.units_website_valid).toBe(1);
    expect(zzStats?.districts).toEqual({ exact: 2, parent_fallback: 1, county_approx: 1 });
    expect(zzStats?.offices).toEqual({ total: 3, placeholder: 1 });
    expect(zzStats?.by_office_type['county-commission']).toEqual({
      offices: 2,
      pay_known: 2,
      deadline_known: 1,
      fee_known: 1,
      signatures_known: 0,
      where_known: 0,
      results_source: 'estimate',
      confidence: { high: 1, medium: 1, low: 1 },
    });
    expect(zzStats?.by_office_type['school-board']?.offices).toBe(1);
    expect(stats).toMatchObject({
      version: VERSION,
      generated_at: NOW.toISOString(),
      missing_states: [],
    });
    expect(zzStats?.filing_adapter).toEqual({ id: null, status: 'none', reason: 'no_adapter' });
    expect(zzStats?.ai).toEqual({ units_extracted: 0, units_queued: 0, budget_exhausted: false });
  });

  it('template is none for a state without a file and rules is null without a module', () => {
    const zzStats = coverageStats(input(bundleInputs([zz()]))).states['ZZ'];
    expect(zzStats?.template).toBe('none');
    expect(zzStats?.rules).toBeNull();
  });

  it('template is invalid when the latest run failed and valid when it passed', () => {
    const failed = stateInputs({
      templates: {
        meta: stageMeta('s03-templates', 'ZZ', { finished_at: '2026-11-01T00:00:00.000Z' }),
        failure: {
          runId: 'r',
          finishedAt: '2026-11-02T00:00:00.000Z',
          failedChecks: ['template_valid'],
          error: null,
        },
      },
    });
    const stats = coverageStats(input(bundleInputs([failed]), { templateStates: new Set(['ZZ']) }));
    expect(stats.states['ZZ']?.template).toBe('invalid');
  });

  it('reported carries a stage count and the writer counts, and not a blocking check', () => {
    const reported = coverageStats(input(bundleInputs([zz()]))).states['ZZ']?.reported;
    expect(reported).toMatchObject({
      legislators: 3,
      legislator_unmapped: 1,
      county: 1000,
      'plausibility_dropped:pay_annual': 2,
    });
    expect(reported).not.toHaveProperty('failures');
  });

  it("stage 1's coverage counters reach reported", () => {
    const reported = coverageStats(input(bundleInputs([zz()]))).states['ZZ']?.reported ?? {};
    expect(reported['website_unchecked']).toBe(4);
    expect(reported['website_invalid']).toBe(2);
    expect(reported['dataset_needs_seed:school-finance']).toBe(1);
    expect(reported).not.toHaveProperty('units_with_website');
    expect(reported).not.toHaveProperty('districts:exact');
  });

  it('a state with only a failure file is in missing_states and has no states entry', () => {
    const inputs = bundleInputs([zz()], {
      missing: [
        {
          state: 'ZY',
          failure: {
            runId: 'r',
            finishedAt: '2026-11-02T00:00:00.000Z',
            failedChecks: [],
            error: 'Error',
          },
        },
      ],
    });
    const stats = coverageStats(input(inputs));
    expect(stats.missing_states).toEqual(['ZY']);
    expect(Object.keys(stats.states)).toEqual(['ZZ']);
  });

  it('lists the blocked hosts and counts ungrounded quotes', () => {
    const state = stateInputs({
      blockedHosts: ['a.example.test'],
      templates: {
        quotes: [
          {
            path: 'a',
            source_url: 'https://example.test/a',
            citation: 'A',
            grounded: false,
            reason: 'challenge',
            checked_at: null,
          },
          {
            path: 'b',
            source_url: 'https://example.test/b',
            citation: 'B',
            grounded: true,
            reason: 'grounded',
            checked_at: null,
          },
        ],
      },
    });
    const zzStats = coverageStats(input(bundleInputs([state]))).states['ZZ'];
    expect(zzStats?.blocked_hosts).toEqual(['a.example.test']);
    expect(zzStats?.quotes_ungrounded).toBe(1);
  });

  it('CoverageStatsSchema refuses a state entry carrying filing_adapters or results_export', () => {
    const stats = coverageStats(input(bundleInputs([zz()])));
    const entry = stats.states['ZZ'];
    for (const extra of [{ filing_adapters: [] }, { results_export: null }]) {
      const bad = { ...stats, states: { ZZ: { ...entry, ...extra } } };
      expect(CoverageStatsSchema.safeParse(bad).success).toBe(false);
    }
  });
});
