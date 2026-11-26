import { OfficeDetailSchema } from '@citizenrun/shared';
import type { OfficeSummary } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { buildOfficeDetail } from './office-detail.ts';
import type { OfficeDetailInput, OfficeDetailRow } from './office-detail.ts';

// Hand-built fixture rows: ids are fixed fixture uuids, every fact a test does not set is null.
const OFFICE_ID = '00000000-0000-7000-8000-000000000001';
const JURISDICTION_ID = '00000000-0000-7000-8000-000000000002';
const DISTRICT_ID = '00000000-0000-7000-8000-000000000003';
const PROOF = {
  source_url: 'https://example.test/fixture-proof',
  quote: 'Fixture quote.',
  confidence: 'medium',
  checked_at: '2027-02-01T08:00:00.000Z',
} as const;

function summary(overrides: Partial<OfficeSummary> = {}): OfficeSummary {
  return {
    id: OFFICE_ID,
    slug: 'fixture-office-1',
    title: 'Fixture Office 1',
    officeTypeId: 'city-council',
    level: 'local',
    electorate: 'public',
    state: 'ZZ',
    jurisdiction: {
      id: JURISDICTION_ID,
      name: 'Fixture City',
      kind: 'city',
      state: 'ZZ',
      website: null,
      timezone: null,
    },
    district: {
      id: DISTRICT_ID,
      tileId: 1,
      name: 'Fixture District 1',
      level: 'local',
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
    impactMode: 'single_issue',
    impactIssueId: null,
    opportunity: null,
    votesToWin: null,
    votesLow: null,
    votesHigh: null,
    votesEstimated: null,
    nextElection: null,
    filingDeadline: null,
    filingStatus: 'no_election',
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

function row(overrides: Partial<OfficeDetailRow> = {}): OfficeDetailRow {
  return {
    officeTypeName: 'City council',
    termYears: null,
    termLimitTerms: null,
    electorate: null,
    benefits: null,
    meetingTimes: null,
    payChangeNote: null,
    whereToFile: null,
    partySelection: null,
    eligibility: null,
    entrenched: null,
    decidedIn: null,
    effort: null,
    easeInputs: null,
    changedAt: '2027-01-01T00:00:00.000Z',
    fieldMeta: {},
    budgetCents: null,
    budgetYear: null,
    jurisdictionFieldMeta: {},
    lean: null,
    leanBasis: null,
    ...overrides,
  };
}

function input(overrides: Partial<OfficeDetailInput> = {}): OfficeDetailInput {
  return {
    summary: summary(),
    row: row(),
    powers: [],
    issueRelevance: [],
    nextElectionDetail: null,
    upcomingElections: [],
    results: [],
    officeholders: [],
    holderParties: [],
    candidates: [],
    candidatesCount: 0,
    ...overrides,
  };
}

describe('buildOfficeDetail', () => {
  it('the result passes the response schema', () => {
    expect(OfficeDetailSchema.safeParse(buildOfficeDetail(input())).success).toBe(true);
  });

  it('board control orders the party split by count, then party, the unknown party last', () => {
    const detail = buildOfficeDetail(
      input({
        summary: summary({ seats: 3, bodySize: 7, seatsUpNext: 3, partisan: true }),
        holderParties: [
          'republican',
          null,
          'democratic',
          'green',
          'democratic',
          null,
          'democratic',
        ],
      }),
    );
    expect(detail.boardControl).toEqual({
      seats: 3,
      bodySize: 7,
      seatsUpNext: 3,
      majority: 4,
      partySplit: [
        { party: 'democratic', count: 3 },
        { party: null, count: 2 },
        { party: 'green', count: 1 },
        { party: 'republican', count: 1 },
      ],
    });
  });

  it('board control is null for a single-person office and has no split when nonpartisan', () => {
    expect(buildOfficeDetail(input()).boardControl).toBeNull();
    expect(buildOfficeDetail(input({ summary: summary({ bodySize: 1 }) })).boardControl).toBeNull();
    const nonpartisan = buildOfficeDetail(
      input({
        summary: summary({ seats: 2, bodySize: null, partisan: false }),
        holderParties: ['democratic'],
      }),
    );
    expect(nonpartisan.boardControl).toEqual({
      seats: 2,
      bodySize: null,
      seatsUpNext: null,
      majority: null,
      partySplit: null,
    });
  });

  it('votesBasis follows votesEstimated, and is null with no votes to win', () => {
    const basis = (votesToWin: number | null, votesEstimated: boolean | null) =>
      buildOfficeDetail(input({ summary: summary({ votesToWin, votesEstimated }) })).votesBasis;
    expect(basis(null, true)).toBeNull();
    expect(basis(1200, null)).toBe('results');
    expect(basis(1200, true)).toBe('estimate');
    expect(basis(1200, false)).toBe('results');
  });

  it('lean is approximate for any basis but precinct, and not with no basis', () => {
    const lean = (leanBasis: OfficeDetailRow['leanBasis']) =>
      buildOfficeDetail(input({ row: row({ lean: 12.5, leanBasis }) })).lean;
    expect(lean('precinct')).toEqual({ points: 12.5, basis: 'precinct', approximate: false });
    expect(lean('county')).toEqual({ points: 12.5, basis: 'county', approximate: true });
    expect(lean(null)).toEqual({ points: 12.5, basis: null, approximate: false });
  });

  it('effort.costCents is the stored dollars value unchanged', () => {
    const assumptions = [
      { key: 'conversations_per_vote', value: 3, unit: 'conversations' },
      { key: 'filing_fee', value: null, unit: 'cents' },
    ];
    const detail = buildOfficeDetail(
      input({ row: row({ effort: { hours: 120, dollars: 254_300, assumptions } }) }),
    );
    expect(detail.effort).toEqual({ hours: 120, costCents: 254_300, assumptions });
    expect(buildOfficeDetail(input()).effort).toBeNull();
  });

  it('term pay and hourly pay come from the annual pay', () => {
    const detail = buildOfficeDetail(
      input({
        summary: summary({ payAnnualCents: 5_294_100, hoursPerWeek: 20 }),
        row: row({ termYears: 4 }),
      }),
    );
    expect(detail.termPayCents).toBe(21_176_400);
    expect(detail.effectiveHourlyCents).toBe(5_090);
  });

  it('stored shapes are camel-cased and a null stays null', () => {
    const detail = buildOfficeDetail(
      input({
        row: row({
          eligibility: [
            {
              kind: 'min_age',
              value: '18',
              quote: 'Fixture quote.',
              source_url: 'https://example.test/fixture-age',
              confidence: 'high',
            },
          ],
          easeInputs: [
            { key: 'lean', value: 4, known: true, contribution: 0.2, note: 'lean_approximate' },
          ],
        }),
      }),
    );
    expect(detail.eligibility).toEqual([
      {
        kind: 'min_age',
        value: '18',
        quote: 'Fixture quote.',
        sourceUrl: 'https://example.test/fixture-age',
        confidence: 'high',
      },
    ]);
    expect(detail.easeInputs).toEqual([
      {
        key: 'lean',
        value: 4,
        known: true,
        sourceUrl: null,
        checkedAt: null,
        contribution: 0.2,
        note: 'lean_approximate',
      },
    ]);
    const empty = buildOfficeDetail(input());
    expect(empty.eligibility).toBeNull();
    expect(empty.easeInputs).toBeNull();
  });

  it('a proof is sent only for a known value, and the budget proof only with a budget', () => {
    const invalid: string[] = [];
    const detail = buildOfficeDetail(
      input({
        summary: summary({ payAnnualCents: 100_000, filingFeeCents: null }),
        row: row({
          fieldMeta: { pay_annual_cents: PROOF, filing_fee_cents: PROOF, term_years: { bad: 1 } },
          termYears: 2,
          budgetCents: null,
          jurisdictionFieldMeta: { budget_cents: PROOF },
        }),
      }),
      (column) => invalid.push(column),
    );
    expect(Object.keys(detail.fieldMeta)).toEqual(['payAnnualCents']);
    expect(detail.budget).toEqual({ cents: null, year: null, meta: null });
    expect(invalid).toEqual(['term_years']);
    const budget = buildOfficeDetail(
      input({
        row: row({
          budgetCents: 9_000_000,
          budgetYear: 2026,
          jurisdictionFieldMeta: { budget_cents: PROOF },
        }),
      }),
    );
    expect(budget.budget.meta).toMatchObject({ confidence: 'medium' });
  });

  it('later keys have their empty forms', () => {
    const detail = buildOfficeDetail(input());
    expect(detail.headlineIssue).toBeNull();
    expect(detail.impactInputs).toEqual({
      issues: [],
      scale: null,
      pivot: null,
      termFactor: null,
      population: null,
      populationSource: null,
      label: null,
    });
    expect(detail.declaredRunners).toEqual([]);
    expect(detail.declaredRunnersCount).toBe(0);
    expect(detail.viewer.running).toBe(false);
  });
});
