import type { StateRules } from '@citizenrun/rules';
import { describe, expect, it } from 'vitest';
import {
  COMMISSION,
  COUNCIL_1,
  PRECINCT_DEM,
  SHERIFF,
  ZZ_ELECTIONS,
  ZZ_NOW,
  ZZ_S04_REFS,
  ZZ_TODAY,
} from '../../__fixtures__/s05/zz-elections.ts';
import { ZZ_RULES_IMPLAUSIBLE } from '../../__fixtures__/s05/zz-rules-implausible.ts';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import { deadlinesState } from './deadlines-state.ts';
import type { DeadlinesInput } from './deadlines-state.ts';
import { headlineFacts } from './headline.ts';

const CODE_URL = 'https://example.test/zz/code';
const NOW_ISO = '2026-11-16T12:00:00.000Z';

function input(overrides: Partial<DeadlinesInput> = {}): DeadlinesInput {
  return {
    state: 'ZZ',
    today: ZZ_TODAY,
    now: ZZ_NOW,
    elections: ZZ_ELECTIONS,
    refs: ZZ_S04_REFS,
    rules: ZZ_RULES,
    newestRetrievedOn: null,
    ...overrides,
  };
}

function check(out: ReturnType<typeof deadlinesState>, name: string) {
  return out.checks.find((c) => c.name === name);
}

describe('deadlinesState', () => {
  it('writes a track for every election of the ZZ offices', () => {
    const out = deadlinesState(input());
    // Commission and sheriff: four primaries and two generals each; council: three generals;
    // the precinct committee: two primaries.
    expect(out.tracks).toHaveLength(17);
    expect(out.counts).toEqual({
      elections: 17,
      tracks: 17,
      rule_implausible: 0,
      ref_missing: 0,
      ref_unscheduled: 0,
      facts: 9,
    });
    expect(check(out, 'rules_plausible')).toEqual({
      name: 'rules_plausible',
      passed: true,
      detail: 'rule_implausible=0',
    });
    expect(check(out, 'deadlines')?.detail).toBe(
      'elections=17 tracks=17 rule_implausible=0 ref_missing=0 ref_unscheduled=0 facts=9',
    );
    const keys = out.tracks.map((t) => t.source_key);
    expect(keys).toEqual([...keys].sort());
  });

  it('an implausible rule is dropped and fails the check', () => {
    const out = deadlinesState(input({ rules: ZZ_RULES_IMPLAUSIBLE }));
    expect(out.tracks.filter((t) => t.election_key.startsWith(`${COUNCIL_1}|`))).toEqual([]);
    expect(out.counts.rule_implausible).toBe(3);
    expect(out.tracks.filter((t) => t.election_key.startsWith(`${COMMISSION}|`))).toHaveLength(6);
    expect(out.tracks).toHaveLength(14);
    expect(check(out, 'rules_plausible')).toEqual({
      name: 'rules_plausible',
      passed: false,
      detail:
        `rule_implausible=3 keys=${COUNCIL_1}|2025-11-04|general||nonpartisan,` +
        `${COUNCIL_1}|2027-11-02|general||nonpartisan,${COUNCIL_1}|2029-11-06|general||nonpartisan`,
    });
  });

  it('a state with no module keeps elections without tracks', () => {
    const out = deadlinesState(input({ rules: null }));
    expect(out.tracks).toEqual([]);
    expect(out.facts).toEqual([]);
    expect(out.certification).toEqual([]);
    expect(check(out, 'rules_plausible')).toEqual({
      name: 'rules_plausible',
      passed: true,
      detail: 'no rules module',
    });
    expect(out.counts.elections).toBe(17);
  });

  it("headline facts come from the next election's first track", () => {
    const out = deadlinesState(input());
    // The commission's next election is 2028-05-02, with a democratic and a republican primary.
    const track = `${COMMISSION}|2028-05-02|primary|democratic|party_primary`;
    expect(out.tracks.some((t) => t.source_key === track)).toBe(true);
    expect(out.facts.filter((f) => f.key === COMMISSION)).toEqual([
      {
        table: 'offices',
        key: COMMISSION,
        field: 'filing_fee_cents',
        value: 45_000,
        evidence: {
          kind: 'computed',
          value: 45_000,
          source_url: CODE_URL,
          quote:
            'Fixture text: a party candidate pays a filing fee of one percent of the annual salary of the office.',
          rule_citation: 'ZZ Fixture Code 106',
          checked_at: NOW_ISO,
        },
        origin: 's05-deadlines',
      },
      {
        table: 'offices',
        key: COMMISSION,
        field: 'signatures_required',
        value: 0,
        evidence: {
          kind: 'computed',
          value: 0,
          source_url: CODE_URL,
          quote: 'Fixture text: a party or nonpartisan candidate files no petition.',
          rule_citation: 'ZZ Fixture Code 112',
          checked_at: NOW_ISO,
        },
        origin: 's05-deadlines',
      },
      {
        table: 'offices',
        key: COMMISSION,
        field: 'where_to_file',
        value: 'Fixture County Board of Elections',
        evidence: {
          kind: 'computed',
          value: 'Fixture County Board of Elections',
          source_url: CODE_URL,
          quote: 'Fixture text: candidates file with the county board of elections.',
          rule_citation: 'ZZ Fixture Code 107',
          checked_at: NOW_ISO,
        },
        origin: 's05-deadlines',
      },
    ]);
    // In byte order of the slug. The sheriff: 1% of 8,000,000. The council's next election is 2027-11-02 (nonpartisan, no
    // where-to-file); the precinct committee pays no fee and files no petition rule.
    expect(out.facts.map((f) => [f.key, f.field, f.value])).toEqual([
      [COUNCIL_1, 'filing_fee_cents', 5_000],
      [COUNCIL_1, 'signatures_required', 0],
      [COMMISSION, 'filing_fee_cents', 45_000],
      [COMMISSION, 'signatures_required', 0],
      [COMMISSION, 'where_to_file', 'Fixture County Board of Elections'],
      [PRECINCT_DEM, 'filing_fee_cents', 0],
      [SHERIFF, 'filing_fee_cents', 80_000],
      [SHERIFF, 'signatures_required', 0],
      [SHERIFF, 'where_to_file', 'Fixture County Board of Elections'],
    ]);
  });

  it('the democratic primary comes before the republican one', () => {
    // A module that names the party in where-to-file makes the chosen election visible.
    const tagged: StateRules = {
      ...ZZ_RULES,
      filingTracks(args) {
        return ZZ_RULES.filingTracks(args).map((track) =>
          track.whereToFile === null
            ? track
            : {
                ...track,
                whereToFile: {
                  ...track.whereToFile,
                  value: `${track.whereToFile.value}, ${args.contest.party ?? 'any'} desk`,
                },
              },
        );
      },
    };
    const out = deadlinesState(input({ rules: tagged }));
    expect(out.facts.find((f) => f.key === COMMISSION && f.field === 'where_to_file')?.value).toBe(
      'Fixture County Board of Elections, democratic desk',
    );
  });

  it('the nonpartisan track comes first among the tracks of an election', () => {
    const out = deadlinesState(input());
    const primary = out.tracks.find(
      (t) => t.source_key === `${COMMISSION}|2028-05-02|primary|democratic|party_primary`,
    );
    if (primary === undefined) {
      throw new Error('no commission primary track');
    }
    const nonpartisan = {
      ...primary,
      source_key: `${primary.election_key}|nonpartisan`,
      track: 'nonpartisan' as const,
      fee_cents: 7_700,
    };
    const facts = headlineFacts(ZZ_S04_REFS, ZZ_ELECTIONS, [primary, nonpartisan], ZZ_TODAY);
    expect(facts.find((f) => f.key === COMMISSION && f.field === 'filing_fee_cents')?.value).toBe(
      7_700,
    );
  });

  it('an office whose next election has no track gets no fact', () => {
    // The implausible module leaves the council's 2027-11-02 general with no track.
    const out = deadlinesState(input({ rules: ZZ_RULES_IMPLAUSIBLE }));
    expect(out.facts.filter((f) => f.key === COUNCIL_1)).toEqual([]);
    expect(out.facts.filter((f) => f.key === COMMISSION)).toHaveLength(3);
    // An office whose elections are all past gets none either.
    expect(headlineFacts(ZZ_S04_REFS, ZZ_ELECTIONS, out.tracks, '2029-11-07')).toEqual([]);
  });

  it('certification dates are ten days after each election', () => {
    const out = deadlinesState(input());
    expect(out.certification).toHaveLength(17);
    const byKey = new Map(out.certification.map((row) => [row.election_key, row]));
    expect(byKey.get(`${COMMISSION}|2028-11-07|general|`)).toEqual({
      election_key: `${COMMISSION}|2028-11-07|general|`,
      date: '2028-11-17',
      citation: 'ZZ Fixture Code 117',
      source_url: CODE_URL,
      quote: 'Fixture text: the results are certified on the 10th day after the election.',
    });
    expect(byKey.get(`${COUNCIL_1}|2025-11-04|general|`)?.date).toBe('2025-11-14');
    expect(byKey.get(`${PRECINCT_DEM}|2026-05-05|primary|democratic`)?.date).toBe('2026-05-15');
    expect(byKey.get(`${SHERIFF}|2028-05-02|primary|republican`)?.date).toBe('2028-05-12');
  });

  it('an election whose office has no ref gets no track', () => {
    const first = ZZ_ELECTIONS[0];
    if (first === undefined) {
      throw new Error('no fixture election');
    }
    const stray = {
      ...first,
      office_key: 'zz-fixture-no-such-office',
      source_key: 'zz-fixture-no-such-office|2026-05-05|primary|democratic',
    };
    const out = deadlinesState(input({ elections: [...ZZ_ELECTIONS, stray] }));
    expect(out.counts.ref_missing).toBe(1);
    expect(out.counts.elections).toBe(18);
    expect(out.tracks).toHaveLength(17);
    expect(out.certification).toHaveLength(17);
  });

  it('an election whose ref has no track set is counted and gets no track', () => {
    const refs = ZZ_S04_REFS.map((ref) =>
      ref.slug === SHERIFF ? { ...ref, track_set: null } : ref,
    );
    const out = deadlinesState(input({ refs }));
    expect(out.counts.ref_unscheduled).toBe(6);
    expect(out.tracks).toHaveLength(11);
  });
});
