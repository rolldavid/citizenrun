// The deadline-rules suite every state test file runs (TEST-deadline-rules; PIPE-rules-fixtures
// rules 1 to 3 and 5; D-330). Test code only: it imports vitest.
import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { isBusinessDay, roll, toDayNumber, weekdayOf } from '../dates.ts';
import type { HolidayCalendar, Weekday } from '../dates.ts';
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

export type RollField = 'opensOn' | 'closesOn' | 'petitionDue';
export type RollDirection = 'next_business_day' | 'previous_business_day';
/** One published case whose date moved for a weekend or holiday (D-330). */
export type RolledCase = {
  readonly caseId: string;
  readonly field: RollField;
  readonly unrolled: IsoDate; // the date the statute's arithmetic gives before the roll
  readonly direction: RollDirection;
};
/** The statute fixes these fields on days that are always business days, so no published year can show a roll. */
export type NeverRolls = {
  readonly never: true;
  readonly fields: readonly RollField[];
  readonly reason: string;
};
/**
 * A holiday (or, for a field whose weekday varies, a weekend) can move these fields, but no
 * published calendar searched shows one moved (D-669, D-889). The roll case's two dates are worked
 * by hand from the cited sections and are never a fixture (D-380).
 */
export type NotYetRolled = {
  readonly published: false;
  /** Each rolled field with the weekday its unrolled date always falls on, or null when that varies. */
  readonly fields: readonly { readonly field: RollField; readonly weekday: Weekday | null }[];
  readonly direction: RollDirection; // the cited computation-of-time section's
  readonly searchedYears: readonly number[]; // ascending: every published calendar searched
  readonly rollCase: {
    readonly year: number;
    readonly field: RollField;
    readonly unrolled: IsoDate;
    readonly expected: IsoDate;
  };
  readonly reason: string;
};
/**
 * The rule's governing statute first applies in `since`, less than three election years before
 * today, so three published years cannot exist yet (D-888). Accepted only while `since` is no more
 * than six years before the checker's today, with every published year from `since` fixtured.
 */
export type NewRegime = {
  readonly newRegime: true;
  readonly since: IsoDate;
  readonly statute: Citation; // the section that sets the regime, cited from a fetched official source
  readonly fields: readonly RollField[]; // a year is published once one of these dates has passed
  readonly reason: string;
};
export type RuleDeclaration = {
  readonly id: string; // the state's name for the rule, for messages ('nc.party_primary')
  readonly trackSet: string; // the OfficeRef.trackSet the rule serves
  readonly track: TrackKind;
  readonly rolled: RolledCase | NeverRolls | NotYetRolled;
  /** In place of the three published years (D-888). */
  readonly years?: NewRegime;
};
/** An office type's party-primary or independent filer case that a new regime cannot have yet (D-888). */
export type FilerDeclaration = {
  readonly officeTypeId: string;
  readonly track: 'party_primary' | 'independent';
  readonly years: NewRegime;
};

/** The last year a never-roll declaration is proved on the module (D-669). */
export const NEVER_ROLLS_LAST_YEAR = 2060;
/** The shortest `reason` a never-roll declaration may give. */
const NEVER_ROLLS_REASON_MIN = 20;
/** A not-yet-rolled roll case is an election year after this one (D-669). */
const NOT_YET_ROLLED_AFTER = 2028;
/** The fewest searched years a not-yet-rolled declaration may give. */
const SEARCHED_YEARS_MIN = 3;
/** A new-regime declaration fails once its `since` is more than this many years before today (D-888). */
export const NEW_REGIME_MAX_YEARS = 6;

export type StateSuiteInput = {
  readonly state: string;
  readonly rules: StateRules;
  readonly fixtures: readonly RulesFixture[];
  readonly declaredRules: readonly RuleDeclaration[];
  readonly officialHosts: readonly string[]; // hosts of the state's election authority and legislature
  readonly partisanOfficeTypes: readonly string[]; // office type ids the state elects on a partisan ballot, less the exempt ones
  readonly partyPrimaryExempt: boolean; // true for a top-two (Washington) or top-four state
  readonly newRegimeFilers?: readonly FilerDeclaration[]; // D-888
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

/** Today's date in UTC: the day a new-regime declaration is measured against (D-888). */
export function checkerToday(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

/** [`three years per rule, one with a roll`] Declarations cover every exercised rule, three years each, with a published roll. */
export function checkThreeYearsAndRoll(
  input: StateSuiteInput,
  today: IsoDate = checkerToday(),
): readonly SuiteProblem[] {
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
    if (rule.years !== undefined) {
      problems.push(
        ...checkNewRegime(input, {
          where: rule.id,
          check: 'three_years_and_roll',
          years: rule.years,
          track: rule.track,
          targets: caseTargets(input, ruleCases),
          caseYears: years,
          today,
        }),
      );
    } else if (years.length < 3) {
      fail(
        rule.id,
        `cases in ${String(years.length)} contest years (${years.sort((a, b) => a - b).join(', ')}); at least three are needed`,
      );
    }
    if ('never' in rule.rolled) {
      problems.push(...checkNeverRolls(input, { ...rule, rolled: rule.rolled }));
      continue;
    }
    if ('published' in rule.rolled) {
      problems.push(...checkNotYetRolled(input, { ...rule, rolled: rule.rolled }));
      continue;
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

/** The year before, the year and the year after, as one calendar of `year`. */
function mergedCalendar(rules: StateRules, state: string, year: number): HolidayCalendar {
  return {
    state,
    year,
    holidays: [year - 1, year, year + 1].flatMap((y) => rules.holidays(y).holidays),
  };
}

function rollFieldValue(track: TrackOut, field: RollField): IsoDate | null {
  switch (field) {
    case 'opensOn':
      return track.opensOn?.value ?? null;
    case 'closesOn':
      return track.closesOn.value;
    case 'petitionDue':
      return track.petitionDue?.value ?? null;
  }
}

/** An office the module is run on, and the kind and party of the contests that count (null: all). */
type WalkTarget = {
  readonly office: OfficeRef;
  readonly like: Pick<ContestRef, 'kind' | 'party'> | null;
};

type WalkedDate = { readonly field: RollField; readonly date: IsoDate };

/**
 * The dates of `fields` on `track` that the module gives the target for the contests of `year`, in
 * the module's order; a null field is skipped. A module error is thrown to the caller.
 */
function trackDatesInYear(
  input: StateSuiteInput,
  target: WalkTarget,
  year: number,
  track: TrackKind,
  fields: readonly RollField[],
): WalkedDate[] {
  const { office, like } = target;
  const contests = input.rules
    .contests({ office, year })
    .filter(
      (contest) =>
        like === null ||
        (contest.kind === like.kind && (like.party === null || contest.party === like.party)),
    );
  const dates: WalkedDate[] = [];
  for (const { date, kind, party } of contests) {
    const tracks = input.rules
      .filingTracks({ office, contest: { date, kind, party } })
      .filter((out) => out.track === track);
    for (const out of tracks) {
      for (const field of fields) {
        const d = rollFieldValue(out, field);
        if (d !== null) {
          dates.push({ field, date: d });
        }
      }
    }
  }
  return dates;
}

/** One target per distinct office the cases state, each counting every contest of its year. */
function caseTargets(input: StateSuiteInput, cases: readonly FixtureCase[]): WalkTarget[] {
  const seen = new Map<string, WalkTarget>();
  for (const fixtureCase of cases) {
    const key = show(fixtureCase.office);
    if (!seen.has(key)) {
      seen.set(key, {
        office: fixtureOffice(input.state, fixtureCase.office, fixtureCase.id),
        like: null,
      });
    }
  }
  return [...seen.values()];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * [`three years per rule, one with a roll`, never-roll part] Proves a never-roll declaration on the
 * module: from the contest year of the rule's earliest case to NEVER_ROLLS_LAST_YEAR, every named
 * field of the declared track is a business day under the module's calendars of the year before,
 * the year and the year after (PIPE-rules-fixtures rule 5, D-669).
 */
export function checkNeverRolls(
  input: StateSuiteInput,
  decl: RuleDeclaration & { readonly rolled: NeverRolls },
): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const fail = (detail: string): void => {
    problems.push({ check: 'three_years_and_roll', where: decl.id, detail });
  };
  const { fields, reason } = decl.rolled;
  if (reason.trim().length < NEVER_ROLLS_REASON_MIN || fields.length === 0) {
    fail(
      `rule ${decl.id} declared never to roll needs at least one field and a reason of ${String(NEVER_ROLLS_REASON_MIN)} characters`,
    );
    return problems;
  }
  const [first] = input.fixtures
    .flatMap((fixture) => fixture.cases)
    .filter(
      (fixtureCase) =>
        fixtureCase.office.trackSet === decl.trackSet && expectsTrack(fixtureCase, decl.track),
    )
    .sort((a, b) => toDayNumber(a.contest.date) - toDayNumber(b.contest.date));
  let checked = 0;
  if (first !== undefined) {
    const target: WalkTarget = {
      office: fixtureOffice(input.state, first.office, first.id),
      like: first.contest,
    };
    for (let year = yearOf(first.contest.date); year <= NEVER_ROLLS_LAST_YEAR; year++) {
      try {
        for (const { field, date: d } of trackDatesInYear(
          input,
          target,
          year,
          decl.track,
          fields,
        )) {
          checked += 1;
          if (!isBusinessDay(d, mergedCalendar(input.rules, input.state, yearOf(d)))) {
            fail(
              `rule ${decl.id} declared never to roll gives ${field} ${d}, which is not a business day`,
            );
          }
        }
      } catch (error) {
        fail(
          `rule ${decl.id} declared never to roll: the module throws for ${String(year)}: ${errorText(error)}`,
        );
      }
    }
  }
  if (checked === 0) {
    fail(`rule ${decl.id} declared never to roll produced no date to check`);
  }
  return problems;
}

/**
 * [`three years per rule, one with a roll`, not-yet-rolled part] Proves a not-yet-rolled
 * declaration (PIPE-rules-fixtures rule 5; D-669, D-889). On the module, for every office the
 * rule's cases state: in each searched year every field with a declared weekday stays on it; in
 * each year between the searched years (or 2028) and the roll year it stays on it and is a
 * business day, so no earlier year moved it; and in the roll year the module gives the expected
 * date. By hand: the roll case's unrolled date is on its declared weekday and is not a business
 * day under the module's calendars of the year before, the year and the year after, and rolling it
 * in the declared direction gives the expected date, which differs from it. The walk ends at
 * NEVER_ROLLS_LAST_YEAR, as the never-roll proof does.
 */
export function checkNotYetRolled(
  input: StateSuiteInput,
  decl: RuleDeclaration & { readonly rolled: NotYetRolled },
): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const name = `rule ${decl.id} declared not yet rolled`;
  const fail = (detail: string): void => {
    problems.push({ check: 'three_years_and_roll', where: decl.id, detail: `${name} ${detail}` });
  };
  const { fields, direction, searchedYears, rollCase, reason } = decl.rolled;
  const names = fields.map((entry) => entry.field);
  if (
    reason.trim().length < NEVER_ROLLS_REASON_MIN ||
    fields.length === 0 ||
    new Set(names).size !== names.length
  ) {
    fail(
      `needs at least one field, each once, and a reason of ${String(NEVER_ROLLS_REASON_MIN)} characters`,
    );
    return problems;
  }
  const ascending = searchedYears.every(
    (year, index) =>
      Number.isInteger(year) && (index === 0 || year > (searchedYears[index - 1] ?? year)),
  );
  if (!ascending || searchedYears.length < SEARCHED_YEARS_MIN) {
    fail(
      `needs at least ${String(SEARCHED_YEARS_MIN)} searched years in ascending order; it gives ${show(searchedYears)}`,
    );
    return problems;
  }
  const ruleCases = input.fixtures
    .flatMap((fixture) => fixture.cases)
    .filter(
      (fixtureCase) =>
        fixtureCase.office.trackSet === decl.trackSet && expectsTrack(fixtureCase, decl.track),
    );
  const caseYears = new Set(ruleCases.map((fixtureCase) => yearOf(fixtureCase.contest.date)));
  for (const year of [...caseYears].sort((a, b) => a - b)) {
    if (!searchedYears.includes(year)) {
      fail(`has a case in ${String(year)}, which is not a searched year`);
    }
  }
  if (fields.some((entry) => entry.weekday === null)) {
    for (const year of searchedYears) {
      if (!caseYears.has(year)) {
        fail(`has a field whose weekday varies and no case in the searched year ${String(year)}`);
      }
    }
  }
  const lastSearched = searchedYears[searchedYears.length - 1] ?? NOT_YET_ROLLED_AFTER;
  const declared = fields.find((entry) => entry.field === rollCase.field);
  if (
    !Number.isInteger(rollCase.year) ||
    rollCase.year <= NOT_YET_ROLLED_AFTER ||
    rollCase.year <= lastSearched ||
    rollCase.year > NEVER_ROLLS_LAST_YEAR
  ) {
    fail(
      `has its roll case in ${String(rollCase.year)}; it must be after ${String(NOT_YET_ROLLED_AFTER)} and after ${String(lastSearched)}, and no later than ${String(NEVER_ROLLS_LAST_YEAR)}`,
    );
    return problems;
  }
  if (declared === undefined) {
    fail(`has its roll case on ${rollCase.field}, which is not a declared field`);
    return problems;
  }
  if (!isDate(rollCase.unrolled) || !isDate(rollCase.expected)) {
    fail(`has a roll case date that is not a date: ${show(rollCase)}`);
    return problems;
  }
  if (declared.weekday !== null && weekdayOf(rollCase.unrolled) !== declared.weekday) {
    fail(
      `has its unrolled ${rollCase.field} ${rollCase.unrolled} off the declared weekday ${String(declared.weekday)}`,
    );
  }
  const calendar = mergedCalendar(input.rules, input.state, yearOf(rollCase.unrolled));
  if (isBusinessDay(rollCase.unrolled, calendar)) {
    fail(`has an unrolled ${rollCase.field} ${rollCase.unrolled} that is a business day`);
  }
  const rolled = roll(rollCase.unrolled, direction, calendar);
  if (rolled !== rollCase.expected) {
    fail(
      `rolls ${rollCase.unrolled} to the ${direction} to ${rolled}; the roll case expects ${rollCase.expected}`,
    );
  }
  if (rollCase.expected === rollCase.unrolled) {
    fail(`expects ${rollCase.expected}, the unrolled date: it does not move`);
  }

  const targets = caseTargets(input, ruleCases);
  const weekdayFields = fields.filter((entry) => entry.weekday !== null);
  let checked = 0;
  const walk = (year: number, wanted: readonly RollField[], each: (found: WalkedDate) => void) => {
    for (const target of targets) {
      try {
        trackDatesInYear(input, target, year, decl.track, wanted).forEach(each);
      } catch (error) {
        fail(`cannot be proved: the module throws for ${String(year)}: ${errorText(error)}`);
      }
    }
  };
  const weekdayOfField = (field: RollField): Weekday | null =>
    fields.find((entry) => entry.field === field)?.weekday ?? null;
  for (const year of searchedYears) {
    walk(
      year,
      weekdayFields.map((entry) => entry.field),
      ({ field, date }) => {
        checked += 1;
        if (weekdayOf(date) !== weekdayOfField(field)) {
          fail(
            `gives ${field} ${date} in the searched year ${String(year)}, off its declared weekday`,
          );
        }
      },
    );
  }
  for (let year = Math.max(NOT_YET_ROLLED_AFTER, lastSearched) + 1; year < rollCase.year; year++) {
    walk(
      year,
      weekdayFields.map((entry) => entry.field),
      ({ field, date }) => {
        checked += 1;
        const moved = weekdayOf(date) !== weekdayOfField(field);
        if (moved || !isBusinessDay(date, mergedCalendar(input.rules, input.state, yearOf(date)))) {
          fail(
            `gives ${field} ${date} in ${String(year)}, before the roll case: the roll case is not the first year a holiday or weekend meets it`,
          );
        }
      },
    );
  }
  let inRollYear = 0;
  walk(rollCase.year, [rollCase.field], ({ date }) => {
    checked += 1;
    inRollYear += 1;
    if (date !== rollCase.expected) {
      fail(
        `gives ${rollCase.field} ${date} in ${String(rollCase.year)}; the roll case expects ${rollCase.expected}`,
      );
    }
  });
  if (inRollYear === 0) {
    fail(`gives no ${rollCase.field} in the roll year ${String(rollCase.year)}`);
  }
  if (checked === 0) {
    fail('produced no date to check');
  }
  return problems;
}

/** The same month and day `NEW_REGIME_MAX_YEARS` years before `today`. */
function newRegimeLimit(today: IsoDate): IsoDate {
  return `${String(yearOf(today) - NEW_REGIME_MAX_YEARS).padStart(4, '0')}${today.slice(4)}`;
}

/**
 * The new-regime declaration of D-888, for a rule or for an office type's filer case. Accepted
 * only when: `fields` is not empty and `reason` has 20 characters; `since` is
 * a date no later than today and no more than NEW_REGIME_MAX_YEARS years before it; the statute
 * has a citation and a quote and is linked over https on an official host; no case is dated before
 * `since`; and every year from `since` to today in which the module gives the track a declared
 * date on or before today (a published year that has the rule) has a case. A module error fails it.
 */
function checkNewRegime(
  input: StateSuiteInput,
  args: {
    readonly where: string;
    readonly check: SuiteCheck;
    readonly years: NewRegime;
    readonly track: TrackKind;
    readonly targets: readonly WalkTarget[];
    readonly caseYears: readonly number[];
    readonly today: IsoDate;
  },
): readonly SuiteProblem[] {
  const { where, check, years, track, targets, caseYears, today } = args;
  const problems: SuiteProblem[] = [];
  const fail = (detail: string): void => {
    problems.push({ check, where, detail: `${where} declared a new regime ${detail}` });
  };
  const { since, statute, fields, reason } = years;
  if (fields.length === 0 || reason.trim().length < NEVER_ROLLS_REASON_MIN) {
    fail(`needs at least one field and a reason of ${String(NEVER_ROLLS_REASON_MIN)} characters`);
    return problems;
  }
  if (!isDate(since)) {
    fail(`gives since ${show(since)}, which is not a date`);
    return problems;
  }
  if (since > today) {
    fail(`since ${since}, after today ${today}`);
  }
  const limit = newRegimeLimit(today);
  if (since < limit) {
    fail(
      `since ${since}, more than ${String(NEW_REGIME_MAX_YEARS)} years before today ${today}: its third published year must be found`,
    );
  }
  let link: URL | null = null;
  try {
    link = new URL(statute.sourceUrl);
  } catch {
    link = null;
  }
  if (
    statute.citation.trim() === '' ||
    statute.quote.trim() === '' ||
    link === null ||
    link.protocol !== 'https:' ||
    !onOfficialHost(link, input.officialHosts)
  ) {
    fail(
      `cites its statute ${show(statute.citation)} without a quote or an https link on ${input.officialHosts.join(', ')}`,
    );
  }
  const first = yearOf(since);
  for (const year of [...caseYears].sort((a, b) => a - b)) {
    if (year < first) {
      fail(`since ${since} has a case in ${String(year)}, before its regime`);
    }
  }
  if (targets.length === 0) {
    fail('has no fixture case whose office the module can be run on');
    return problems;
  }
  for (let year = first; year <= yearOf(today); year++) {
    let published = false;
    for (const target of targets) {
      try {
        published ||= trackDatesInYear(input, target, year, track, fields).some(
          ({ date }) => date <= today,
        );
      } catch (error) {
        fail(`cannot be proved: the module throws for ${String(year)}: ${errorText(error)}`);
      }
    }
    if (published && !caseYears.includes(year)) {
      fail(`has a published ${track} date in ${String(year)} and no case in that year`);
    }
  }
  return problems;
}
/** [`the published 2024 and 2026 calendars are present`] Fixtures hold a contest or case dated in each cycle. */
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

/**
 * [`a party-primary and an independent filer per partisan office type`] Both filers for every type
 * the state passes. A filer case that a new regime cannot have yet is met by its declaration
 * (D-888), proved as a rule's is on the offices of the type's cases.
 */
export function checkPartyAndIndependent(
  input: StateSuiteInput,
  today: IsoDate = checkerToday(),
): readonly SuiteProblem[] {
  const problems: SuiteProblem[] = [];
  const cases = input.fixtures.flatMap((fixture) => fixture.cases);
  const filers = input.newRegimeFilers ?? [];
  for (const filer of filers) {
    const where = `${filer.officeTypeId} ${filer.track}`;
    if (!input.partisanOfficeTypes.includes(filer.officeTypeId)) {
      problems.push({
        check: 'party_and_independent',
        where,
        detail: `${where} declared a new regime for an office type the state does not pass as partisan`,
      });
      continue;
    }
    const typeCases = cases.filter(
      (fixtureCase) => fixtureCase.office.officeTypeId === filer.officeTypeId,
    );
    const caseYears = typeCases
      .filter((fixtureCase) => expectsTrack(fixtureCase, filer.track))
      .map((fixtureCase) => yearOf(fixtureCase.contest.date));
    problems.push(
      ...checkNewRegime(input, {
        where,
        check: 'party_and_independent',
        years: filer.years,
        track: filer.track,
        targets: caseTargets(input, typeCases),
        caseYears: [...new Set(caseYears)],
        today,
      }),
    );
  }
  for (const officeTypeId of input.partisanOfficeTypes) {
    const typeCases = cases.filter(
      (fixtureCase) => fixtureCase.office.officeTypeId === officeTypeId,
    );
    const needed: TrackKind[] = input.partyPrimaryExempt
      ? ['independent']
      : ['party_primary', 'independent'];
    for (const track of needed) {
      const declared = filers.some(
        (filer) => filer.officeTypeId === officeTypeId && filer.track === track,
      );
      if (!declared && !typeCases.some((fixtureCase) => expectsTrack(fixtureCase, track))) {
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
