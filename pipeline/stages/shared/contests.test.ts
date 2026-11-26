import { describe, expect, it } from 'vitest';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import { contestsInWindow, electionWindow, nextElecting } from './contests.ts';
import { OfficeRefRowSchema, toRulesOfficeRef } from './office-ref.ts';
import type { OfficeRefRow } from './office-ref.ts';

const TODAY = '2026-11-16';

function ref(overrides: Partial<OfficeRefRow>): OfficeRefRow {
  return OfficeRefRowSchema.parse({
    slug: 'zz-fixture-county-board-of-commissioners',
    identity: 'county:ZZ:99001|county-commissioner|tiger:county:99001',
    origin: 's04-expand',
    template_key: 'county-commissioner',
    office_type_id: 'county-commission',
    jurisdiction_key: 'county:ZZ:99001',
    jurisdiction_kind: 'county',
    district_key: 'tiger:county:99001',
    county_geoid: '99001',
    party: null,
    party_selection: null,
    partisan: true,
    schedule: 'zz_county_general',
    track_set: 'zz_partisan',
    stagger: [
      { group: 'A', seats: 3, every: 4, first: 2026 },
      { group: 'B', seats: 2, every: 4, first: 2028 },
    ],
    stagger_group: null,
    seats: 5,
    body_size: 5,
    term_years: 4,
    pay_annual_cents: null,
    pay_range: null,
    template_seats: 5,
    population: 1000,
    ...overrides,
  });
}

function summary(contests: ReturnType<typeof contestsInWindow>) {
  return contests.map((c) => [c.date, c.kind, c.party, c.seatsUp]);
}

describe('electionWindow', () => {
  it('the window runs from 400 days before to 1,095 days after today', () => {
    expect(electionWindow(TODAY)).toEqual({
      from: '2025-10-12',
      to: '2029-11-15',
      years: [2025, 2026, 2027, 2028, 2029],
    });
  });
});

describe('contestsInWindow', () => {
  it('a staggered at-large body counts the groups elected that year', () => {
    expect(summary(contestsInWindow(ref({}), 'ZZ', ZZ_RULES, TODAY))).toEqual([
      ['2026-05-05', 'primary', 'democratic', 3],
      ['2026-05-05', 'primary', 'republican', 3],
      ['2026-11-03', 'general', null, 3],
      ['2028-05-02', 'primary', 'democratic', 2],
      ['2028-05-02', 'primary', 'republican', 2],
      ['2028-11-07', 'general', null, 2],
    ]);
  });

  it('an office elected together counts every seat', () => {
    const sheriff = ref({
      template_key: 'sheriff',
      office_type_id: 'sheriff',
      stagger: [],
      seats: 1,
      body_size: null,
    });
    expect(
      summary(contestsInWindow(sheriff, 'ZZ', ZZ_RULES, TODAY)).filter((c) => c[1] === 'general'),
    ).toEqual([
      ['2026-11-03', 'general', null, 1],
      ['2028-11-07', 'general', null, 1],
    ]);
  });

  it("a district office keeps only its group's years", () => {
    const senate = ref({
      template_key: null,
      office_type_id: 'state-senate',
      jurisdiction_kind: 'state',
      schedule: 'zz_state_general',
      stagger: [{ group: 'A', seats: 1, every: 4, first: 2026 }],
      stagger_group: 'A',
      seats: 1,
      body_size: null,
    });
    expect(summary(contestsInWindow(senate, 'ZZ', ZZ_RULES, TODAY))).toEqual([
      ['2026-05-05', 'primary', 'democratic', 1],
      ['2026-05-05', 'primary', 'republican', 1],
      ['2026-11-03', 'general', null, 1],
    ]);
  });

  it('keeps odd-year contests inside the window only', () => {
    const council = ref({
      template_key: 'city-council',
      office_type_id: 'city-council',
      jurisdiction_kind: 'city',
      schedule: 'zz_local_odd',
      track_set: 'zz_nonpartisan',
      partisan: false,
      stagger: [],
      seats: 1,
      body_size: null,
    });
    expect(summary(contestsInWindow(council, 'ZZ', ZZ_RULES, TODAY))).toEqual([
      ['2025-11-04', 'general', null, 1],
      ['2027-11-02', 'general', null, 1],
      ['2029-11-06', 'general', null, 1],
    ]);
  });

  it('an office with no schedule has no contests', () => {
    expect(
      contestsInWindow(ref({ schedule: null, track_set: null }), 'ZZ', ZZ_RULES, TODAY),
    ).toEqual([]);
  });

  const committee = (selection: OfficeRefRow['party_selection']) =>
    ref({
      template_key: 'precinct-committee',
      office_type_id: 'party-precinct-committee',
      jurisdiction_kind: 'party',
      party: 'democratic',
      party_selection: selection,
      schedule: 'zz_state_primary',
      track_set: 'zz_party',
      stagger: [],
      seats: 1,
      body_size: null,
    });

  it('a caucus party committee has no contests', () => {
    expect(contestsInWindow(committee('caucus'), 'ZZ', ZZ_RULES, TODAY)).toEqual([]);
  });

  it("a primary-ballot party committee's contests carry its party", () => {
    expect(summary(contestsInWindow(committee('primary_ballot'), 'ZZ', ZZ_RULES, TODAY))).toEqual([
      ['2026-05-05', 'primary', 'democratic', 1],
      ['2028-05-02', 'primary', 'democratic', 1],
    ]);
  });
});

describe('nextElecting', () => {
  it('the next electing contest is the earliest general on or after today', () => {
    const contests = contestsInWindow(ref({}), 'ZZ', ZZ_RULES, TODAY);
    expect(nextElecting(contests, TODAY)?.date).toBe('2028-11-07');
    expect(nextElecting(contests, '2026-11-03')?.date).toBe('2026-11-03');
    expect(nextElecting(contests, '2028-11-08')).toBeNull();
  });

  it('a primary that elects outright counts', () => {
    const contests = contestsInWindow(ref({}), 'ZZ', ZZ_RULES, TODAY).map((c) =>
      c.kind === 'primary' ? { ...c, electsOutright: true } : c,
    );
    expect(nextElecting(contests, '2028-01-01')?.date).toBe('2028-05-02');
  });
});

describe('toRulesOfficeRef', () => {
  it('uses the office type as the template key of an office with no template entry', () => {
    const office = toRulesOfficeRef(ref({ template_key: null }), 'ZZ');
    expect(office).toEqual({
      state: 'ZZ',
      templateKey: 'county-commission',
      officeTypeId: 'county-commission',
      jurisdictionKind: 'county',
      countyGeoid: '99001',
      partisan: true,
      schedule: 'zz_county_general',
      trackSet: 'zz_partisan',
      staggerGroup: null,
      termYears: 4,
      payAnnualCents: null,
      population: 1000,
    });
  });
});
