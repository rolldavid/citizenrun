// The deadline-rules suite every state test file runs (TEST-deadline-rules; PIPE-rules-fixtures
// rules 1 to 3 and 5; D-330, R-016, R-099). Test code only: it imports vitest.
import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { isBusinessDay, roll, toDayNumber } from '../dates.ts';
import type {
  Citation,
  Computed,
  ContestRef,
  FixtureTrackExpect,
  IsoDate,
  OfficeRef,
  RulesFixture,
  StateRules,
  TrackKind,
  TrackOut,
} from '../types.ts';

export type RuleDeclaration = {
  readonly id: string; // the state's name for the rule, for messages ('nc.party_primary')
  readonly trackSet: string; // the OfficeRef.trackSet the rule serves
  readonly track: TrackKind;
  readonly rolled: {
    // one published case whose date moved for a weekend or holiday (D-330)
    readonly caseId: string;
    readonly field: 'opensOn' | 'closesOn' | 'petitionDue';
    readonly unrolled: IsoDate; // the date the statute's arithmetic gives before the roll
    readonly direction: 'next_business_day' | 'previous_business_day';
  };
};

export type StateSuiteInput = {
  readonly state: string;
  readonly rules: StateRules;
  readonly fixtures: readonly RulesFixture[];
  readonly declaredRules: readonly RuleDeclaration[];
  readonly officialHosts: readonly string[]; // hosts of the state's election authority and legislature
  readonly partisanOfficeTypes: readonly string[]; // office type ids the state elects on a partisan ballot, less the exempt ones
  readonly partyPrimaryExempt: boolean; // true for a top-two (Washington) or top-four state
};

export type SuiteCheck =
  | 'matches_calendar'
  | 'cites_statute'
  | 'valid_from'
  | 'three_years_and_roll'
  | 'cycles_present'
  | 'official_source'
  | 'party_and_independent'
  | 'zone_proof';

export type SuiteProblem = {
  readonly check: SuiteCheck;
  readonly where: string;
  readonly detail: string;
};

type FixtureCase = RulesFixture['cases'][number];
type FixtureOffice = FixtureCase['office'];

/** Every key of OfficeRef: the record fails to compile when OfficeRef gains or loses a key. */
const OFFICE_KEY_SET: Record<keyof OfficeRef, true> = {
  state: true,
  templateKey: true,
  officeTypeId: true,
  jurisdictionKind: true,
  countyGeoid: true,
  partisan: true,
  schedule: true,
  trackSet: true,
  staggerGroup: true,
  termYears: true,
  payAnnualCents: true,
  population: true,
};
const OFFICE_KEYS = Object.keys(OFFICE_KEY_SET) as (keyof OfficeRef)[];

/** The keys of a track expectation that hold a date or a time, compared as `value` or null. */
const EXPECT_KEYS = [
  'opensOn',
  'closesOn',
  'closesTime',
  'petitionOpens',
  'petitionDue',
  'withdrawalDeadline',
] as const satisfies readonly (keyof FixtureTrackExpect & keyof TrackOut)[];

const SHA256 = /^[0-9a-f]{64}$/;

/** A fixture's partial office as an OfficeRef: reading a key the fixture did not state throws, naming the case and the key. */
export function fixtureOffice(state: string, office: FixtureOffice, caseId: string): OfficeRef {
  const result: Record<string, unknown> = {};
  for (const key of OFFICE_KEYS) {
    if (key === 'state') {
      Object.defineProperty(result, key, { value: state, enumerable: true });
    } else if (Object.hasOwn(office, key)) {
      Object.defineProperty(result, key, { value: office[key], enumerable: true });
    } else {
      Object.defineProperty(result, key, {
        enumerable: true,
        get(): never {
          throw new Error(`${caseId} does not state ${key}`);
        },
      });
    }
  }
  return result as OfficeRef;
}

type ContestOutputs = {
  readonly contest: RulesFixture['contests'][number];
  readonly outputs: ReturnType<StateRules['contests']>;
};
type CaseOutputs = {
  readonly fixtureCase: FixtureCase;
  readonly tracks: readonly TrackOut[];
  readonly certification: Computed<IsoDate> | null;
};

function contestOutputs(input: StateSuiteInput): ContestOutputs[] {
  return input.fixtures.flatMap((fixture) =>
    fixture.contests.map((contest) => ({
      contest,
      outputs: input.rules.contests({
        office: fixtureOffice(input.state, contest.office, contest.id),
        year: contest.year,
      }),
    })),
  );
}

function caseOutputs(input: StateSuiteInput): CaseOutputs[] {
  return input.fixtures.flatMap((fixture) =>
    fixture.cases.map((fixtureCase) => {
      const office = fixtureOffice(input.state, fixtureCase.office, fixtureCase.id);
      return {
        fixtureCase,
        tracks: input.rules.filingTracks({ office, contest: fixtureCase.contest }),
        certification: input.rules.certificationDate({ office, contest: fixtureCase.contest }),
      };
    }),
  );
}

/** One rule output with the date of the contest it was computed for. */
type CitedOutput = {
  readonly where: string;
  readonly contestDate: IsoDate;
  readonly citation: Citation;
};

/** Every Computed the module returns for the fixtures: tracks, alternatives, dateCitation, certificationDate. */
function citedOutputs(input: StateSuiteInput): readonly CitedOutput[] {
  const cited: CitedOutput[] = [];
  for (const { contest, outputs } of contestOutputs(input)) {
    for (const out of outputs) {
      cited.push({
        where: `${contest.id} contest on ${out.date} dateCitation`,
        contestDate: out.date,
        citation: out.dateCitation,
      });
    }
  }
  for (const { fixtureCase, tracks, certification } of caseOutputs(input)) {
    const contestDate = fixtureCase.contest.date;
    for (const track of tracks) {
      const fields: Record<string, Computed<unknown> | null> = {
        opensOn: track.opensOn,
        closesOn: track.closesOn,
        closesTime: track.closesTime,
        petitionOpens: track.petitionOpens,
        petitionDue: track.petitionDue,
        fee: track.fee,
        signatures: track.signatures,
        whereToFile: track.whereToFile,
        withdrawalDeadline: track.withdrawalDeadline,
      };
      for (const [field, computed] of Object.entries(fields)) {
        if (computed !== null) {
          cited.push({
            where: `${fixtureCase.id} ${track.track}.${field}`,
            contestDate,
            citation: computed.citation,
          });
        }
      }
      track.alternatives.forEach((alternative, index) => {
        cited.push({
          where: `${fixtureCase.id} ${track.track}.alternatives[${String(index)}]`,
          contestDate,
          citation: alternative.signatures.citation,
        });
      });
    }
    if (certification !== null) {
      cited.push({
        where: `${fixtureCase.id} certificationDate`,
        contestDate,
        citation: certification.citation,
      });
    }
  }
  return cited;
}

function show(value: unknown): string {
  return JSON.stringify(value);
}

function isDate(d: string): boolean {
  try {
    toDayNumber(d);
    return true;
  } catch {
    return false;
  }
}

function yearOf(d: IsoDate): number {
  return Number(d.slice(0, 4));
}

function expectsTrack(fixtureCase: FixtureCase, track: TrackKind): boolean {
  return fixtureCase.expect.some((expected) => expected.track === track);
}

/** A name for a fixture in messages: its first contest or case id. */
function fixtureName(fixture: RulesFixture, index: number): string {
  return fixture.contests[0]?.id ?? fixture.cases[0]?.id ?? `fixture ${String(index + 1)}`;
}

/** [`matches the official calendar`] Contests equal `expect` in order; each expected track appears once and equals its stated keys. */
export function checkMatchesCalendar(input: StateSuiteInput): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  for (const { contest, outputs } of contestOutputs(input)) {
    const got = outputs.map(({ date, kind, party }): ContestRef => ({ date, kind, party }));
    const want = contest.expect.map(({ date, kind, party }): ContestRef => ({ date, kind, party }));
    if (show(got) !== show(want)) {
      problems.push({
        check: 'matches_calendar',
        where: contest.id,
        detail: `the module gives contests ${show(got)}; the calendar says ${show(want)}`,
      });
    }
  }
  for (const { fixtureCase, tracks } of caseOutputs(input)) {
    for (const expected of fixtureCase.expect) {
      const matching = tracks.filter((track) => track.track === expected.track);
      const [track] = matching;
      if (track === undefined || matching.length > 1) {
        problems.push({
          check: 'matches_calendar',
          where: fixtureCase.id,
          detail: `the module gives ${String(matching.length)} ${expected.track} tracks; the calendar has one`,
        });
        continue;
      }
      for (const key of EXPECT_KEYS) {
        if (!Object.hasOwn(expected, key)) {
          continue;
        }
        const want = expected[key] ?? null;
        const got = key === 'closesOn' ? track.closesOn.value : (track[key]?.value ?? null);
        if (got !== want) {
          problems.push({
            check: 'matches_calendar',
            where: fixtureCase.id,
            detail: `${expected.track}.${key} is ${show(got)}; the calendar says ${show(want)}`,
          });
        }
      }
    }
  }
  return problems;
}

/** [`cites its statute`] Every Computed has a citation, an https link that parses and a quote. */
export function checkCitesStatute(input: StateSuiteInput): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  for (const { where, citation } of citedOutputs(input)) {
    const fail = (detail: string): void => {
      problems.push({ check: 'cites_statute', where, detail });
    };
    if (citation.citation.trim() === '') {
      fail('the citation is empty');
    }
    let protocol: string | null = null;
    try {
      protocol = new URL(citation.sourceUrl).protocol;
    } catch {
      fail(`the source link ${show(citation.sourceUrl)} does not parse`);
    }
    if (protocol !== null && protocol !== 'https:') {
      fail(`the source link ${show(citation.sourceUrl)} is not https`);
    }
    if (citation.quote.trim() === '') {
      fail('the quote is empty');
    }
  }
  return problems;
}

/** [`respects valid_from`] Every citation's window contains the contest's date. */
export function checkValidFrom(input: StateSuiteInput): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  for (const { where, contestDate, citation } of citedOutputs(input)) {
    const { validFrom, validTo } = citation;
    if (!(validFrom <= contestDate && (validTo === null || contestDate <= validTo))) {
      problems.push({
        check: 'valid_from',
        where,
        detail: `cites text in force from ${validFrom} to ${validTo ?? 'now'} for a contest on ${contestDate}`,
      });
    }
  }
  return problems;
}

/** [`three years per rule, one with a roll`] Declarations cover every exercised rule, three years each, with a published roll. */
export function checkThreeYearsAndRoll(input: StateSuiteInput): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const fail = (where: string, detail: string): void => {
    problems.push({ check: 'three_years_and_roll', where, detail });
  };
  const cases = input.fixtures.flatMap((fixture) => fixture.cases);
  const exercised = new Map<string, { trackSet: string; track: TrackKind }>();
  for (const fixtureCase of cases) {
    for (const expected of fixtureCase.expect) {
      const pair = { trackSet: fixtureCase.office.trackSet, track: expected.track };
      exercised.set(`${pair.trackSet} ${pair.track}`, pair);
    }
  }
  for (const [label, pair] of exercised) {
    const declared = input.declaredRules.some(
      (rule) => rule.trackSet === pair.trackSet && rule.track === pair.track,
    );
    if (!declared) {
      fail(label, 'the fixture cases exercise this track set and track, and no rule declares it');
    }
  }
  for (const rule of input.declaredRules) {
    const ruleCases = cases.filter(
      (fixtureCase) =>
        fixtureCase.office.trackSet === rule.trackSet && expectsTrack(fixtureCase, rule.track),
    );
    const years = [...new Set(ruleCases.map((fixtureCase) => yearOf(fixtureCase.contest.date)))];
    if (years.length < 3) {
      fail(
        rule.id,
        `cases in ${String(years.length)} contest years (${years.sort((a, b) => a - b).join(', ')}); at least three are needed`,
      );
    }
    const { caseId, field, unrolled, direction } = rule.rolled;
    const rolledCase = ruleCases.find((fixtureCase) => fixtureCase.id === caseId);
    if (rolledCase === undefined) {
      fail(rule.id, `the rolled case ${caseId} is not one of the rule's cases`);
      continue;
    }
    if (!isDate(unrolled)) {
      fail(rule.id, `the unrolled date ${show(unrolled)} is not a date`);
      continue;
    }
    const calendar = input.rules.holidays(yearOf(unrolled));
    if (isBusinessDay(unrolled, calendar)) {
      fail(
        rule.id,
        `the unrolled date ${unrolled} is not a Saturday, a Sunday or a holiday of the module's ${String(calendar.year)} calendar`,
      );
    }
    const expected = rolledCase.expect.find((track) => track.track === rule.track)?.[field] ?? null;
    if (expected === null) {
      fail(rule.id, `${caseId} states no ${field} for its ${rule.track} track`);
      continue;
    }
    const rolled = roll(unrolled, direction, calendar);
    if (rolled !== expected) {
      fail(
        rule.id,
        `rolling ${unrolled} to the ${direction} gives ${rolled}; ${caseId} publishes ${expected}`,
      );
    }
    if (expected === unrolled) {
      fail(rule.id, `${caseId} publishes ${field} ${expected}, the unrolled date: it did not move`);
    }
  }
  return problems;
}

/** [`the published 2024 and 2026 calendars are present`] Fixtures hold a contest or case dated in each cycle (R-099). */
export function checkCyclesPresent(input: StateSuiteInput): readonly SuiteProblem[] {
  const years = new Set<number>();
  for (const fixture of input.fixtures) {
    for (const contest of fixture.contests) {
      years.add(contest.year);
      for (const expected of contest.expect) {
        years.add(yearOf(expected.date));
      }
    }
    for (const fixtureCase of fixture.cases) {
      years.add(yearOf(fixtureCase.contest.date));
    }
  }
  return [2024, 2026]
    .filter((year) => !years.has(year))
    .map((year): SuiteProblem => ({
      check: 'cycles_present',
      where: input.state,
      detail: `no fixture holds a contest or case dated in ${String(year)}`,
    }));
}

function onOfficialHost(url: URL, hosts: readonly string[]): boolean {
  return hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

/** [`the source is official`] An https link on an official host, a SHA-256, a title, quotes and a retrieval date. */
export function checkOfficialSource(input: StateSuiteInput): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  input.fixtures.forEach((fixture, index) => {
    const where = fixtureName(fixture, index);
    const fail = (detail: string): void => {
      problems.push({ check: 'official_source', where, detail });
    };
    const { title, url, retrievedOn, sha256 } = fixture.source;
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      fail(`the source link ${show(url)} does not parse`);
    }
    if (parsed !== null && parsed.protocol !== 'https:') {
      fail(`the source link ${show(url)} is not https`);
    }
    if (parsed !== null && !onOfficialHost(parsed, input.officialHosts)) {
      fail(`the source host ${parsed.hostname} is not one of ${input.officialHosts.join(', ')}`);
    }
    if (!SHA256.test(sha256)) {
      fail(`the hash ${show(sha256)} is not 64 lower-case hex characters`);
    }
    if (title.trim() === '') {
      fail('the source title is empty');
    }
    if (!isDate(retrievedOn)) {
      fail(`the retrieval date ${show(retrievedOn)} is not a date`);
    }
    for (const item of [...fixture.contests, ...fixture.cases]) {
      if (item.quote.trim() === '') {
        fail(`${item.id} has an empty quote`);
      }
    }
  });
  return problems;
}

/** [`a party-primary and an independent filer per partisan office type`] Both filers for every type the state passes (R-016). */
export function checkPartyAndIndependent(input: StateSuiteInput): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const cases = input.fixtures.flatMap((fixture) => fixture.cases);
  for (const officeTypeId of input.partisanOfficeTypes) {
    const typeCases = cases.filter(
      (fixtureCase) => fixtureCase.office.officeTypeId === officeTypeId,
    );
    const needed: TrackKind[] = input.partyPrimaryExempt
      ? ['independent']
      : ['party_primary', 'independent'];
    for (const track of needed) {
      if (!typeCases.some((fixtureCase) => expectsTrack(fixtureCase, track))) {
        problems.push({
          check: 'party_and_independent',
          where: officeTypeId,
          detail: `no case expects a ${track} track`,
        });
      }
    }
  }
  return problems;
}

/** Every contest and case output, serialized, by where it came from. */
function serializedOutputs(input: StateSuiteInput): Map<string, string> {
  const outputs = new Map<string, string>();
  for (const { contest, outputs: contests } of contestOutputs(input)) {
    outputs.set(contest.id, show(contests));
  }
  for (const { fixtureCase, tracks, certification } of caseOutputs(input)) {
    outputs.set(fixtureCase.id, show({ tracks, certification }));
  }
  return outputs;
}

/** [`zone-proof`] Under eachZone, every contest and case output is the same in both zones. */
export async function checkZoneProof(input: StateSuiteInput): Promise<readonly SuiteProblem[]> {
  const runs: { zone: string; outputs: Map<string, string> }[] = [];
  await eachZone((zone) => {
    runs.push({ zone, outputs: serializedOutputs(input) });
  });
  const [first, ...others] = runs;
  if (first === undefined) {
    return [];
  }
  const problems: SuiteProblem[] = [];
  for (const other of others) {
    for (const [where, output] of first.outputs) {
      const otherOutput = other.outputs.get(where);
      if (otherOutput !== output) {
        problems.push({
          check: 'zone_proof',
          where,
          detail: `in ${first.zone} the module gives ${output}; in ${other.zone} ${otherOutput ?? 'nothing'}`,
        });
      }
    }
  }
  return problems;
}

/** Registers describe('<state> deadline rules') with one it per check, each expecting no problem. */
export function runStateRulesSuite(input: StateSuiteInput): void {
  const each = (check: (suite: StateSuiteInput) => readonly SuiteProblem[]) => async () => {
    await eachZone(() => {
      expect(check(input)).toEqual([]);
    });
  };
  describe(`${input.state} deadline rules`, () => {
    it('matches the official calendar', each(checkMatchesCalendar));
    it('cites its statute', each(checkCitesStatute));
    it('respects valid_from', each(checkValidFrom));
    it('three years per rule, one with a roll', each(checkThreeYearsAndRoll));
    it('the published 2024 and 2026 calendars are present', each(checkCyclesPresent));
    it('the source is official', each(checkOfficialSource));
    it(
      'a party-primary and an independent filer per partisan office type',
      each(checkPartyAndIndependent),
    );
    it('zone-proof', async () => {
      expect(await checkZoneProof(input)).toEqual([]);
    });
  });
}
