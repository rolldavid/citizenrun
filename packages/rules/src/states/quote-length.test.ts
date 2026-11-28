import { FieldMetaRowSchema } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { LA_FIXTURES } from '../__fixtures__/la/index.ts';
import { NC_FIXTURES } from '../__fixtures__/nc/index.ts';
import { TX_FIXTURES } from '../__fixtures__/tx/index.ts';
import { VA_FIXTURES } from '../__fixtures__/va/index.ts';
import { WA_FIXTURES } from '../__fixtures__/wa/index.ts';
import type {
  Citation,
  ContestRef,
  OfficeRef,
  RulesFixture,
  StateRules,
  TrackOut,
} from '../types.ts';
import { laRules } from './la.ts';
import { ncRules } from './nc.ts';
import { txRules } from './tx.ts';
import { vaRules } from './va.ts';
import { waRules } from './wa.ts';

/** The pipeline stores every quote in a field meta row, so no quote may be longer than its column. */
const QUOTE_LIMIT = FieldMetaRowSchema.shape.quote.unwrap().maxLength;

const FIRST_YEAR = 2024;
const LAST_YEAR = 2030;

const MODULES: readonly (readonly [StateRules, readonly RulesFixture[]])[] = [
  [ncRules, NC_FIXTURES],
  [waRules, WA_FIXTURES],
  [txRules, TX_FIXTURES],
  [laRules, LA_FIXTURES],
  [vaRules, VA_FIXTURES],
];

/** The office type ids of data/office-types.yaml; this package reads no file, so they are listed. */
const OFFICE_TYPE_IDS: readonly string[] = [
  'us-senate',
  'us-house',
  'governor',
  'statewide-executive-other',
  'attorney-general',
  'secretary-of-state',
  'state-treasurer',
  'state-senate',
  'state-house',
  'utility-commission',
  'oil-gas-land-commission',
  'insurance-commissioner',
  'labor-commissioner',
  'state-education-board',
  'state-appellate-judge',
  'county-commission',
  'county-executive',
  'sheriff',
  'district-attorney',
  'county-clerk',
  'county-treasurer',
  'county-assessor',
  'board-of-review',
  'trial-judge',
  'county-row-other',
  'mayor',
  'city-council',
  'township-board',
  'city-officer',
  'school-board',
  'community-college-board',
  'water-district-board',
  'soil-water-conservation-board',
  'hospital-district-board',
  'transit-board',
  'public-power-board',
  'fire-district-board',
  'special-district-other',
  'coop-board',
  'pension-board',
  'party-precinct-committee',
  'party-committee',
];
/** An office type no module names, which takes every module's default branch. */
const UNNAMED_TYPE = 'no-such-office-type';

const JURISDICTION_KINDS: readonly OfficeRef['jurisdictionKind'][] = [
  'state',
  'county',
  'city',
  'township',
  'school_district',
  'special_district',
  'coop',
  'party',
];
const PARTISAN: readonly (boolean | null)[] = [true, false, null];
// The modules cite one statute for all of a population's tiers, so a small and a large population
// reach every citation.
const POPULATIONS: readonly (number | null)[] = [null, 1_000, 1_000_000];

function baseOffice(state: string): OfficeRef {
  return {
    state,
    templateKey: '',
    officeTypeId: '',
    jurisdictionKind: 'state',
    countyGeoid: null,
    partisan: null,
    schedule: '',
    trackSet: '',
    staggerGroup: null,
    termYears: null,
    payAnnualCents: null,
    population: null,
  };
}

/** An office that records each field a rule reads from it. */
function recording(office: OfficeRef, read: Set<string>): OfficeRef {
  return new Proxy(office, {
    get(target, key, receiver): unknown {
      if (typeof key === 'string') {
        read.add(key);
      }
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

/** A rule that declines a case (an office it has no rule for) throws; that case has no citation. */
function attempt<T>(run: () => T): T | null {
  try {
    return run();
  } catch {
    return null;
  }
}

function addTrackCitations(found: Set<Citation>, tracks: readonly TrackOut[]): void {
  for (const track of tracks) {
    for (const computed of [
      track.opensOn,
      track.closesOn,
      track.closesTime,
      track.petitionOpens,
      track.petitionDue,
      track.fee,
      track.signatures,
      track.whereToFile,
      track.withdrawalDeadline,
      ...track.alternatives.map((alternative) => alternative.signatures),
    ]) {
      if (computed !== null) {
        found.add(computed.citation);
      }
    }
  }
}

/** Every citation of one office's contests, tracks, certification dates and pay. */
function addOfficeCitations(
  found: Set<Citation>,
  rules: StateRules,
  office: OfficeRef,
  extraContests: readonly ContestRef[],
): void {
  const contests: ContestRef[] = [...extraContests];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
    for (const contest of attempt(() => rules.contests({ office, year })) ?? []) {
      found.add(contest.dateCitation);
      contests.push({ date: contest.date, kind: contest.kind, party: contest.party });
    }
    const pay = attempt(() => rules.countyPay({ office, year }));
    if (pay !== null) {
      found.add(pay.citation);
    }
  }
  for (const contest of contests) {
    addTrackCitations(found, attempt(() => rules.filingTracks({ office, contest })) ?? []);
    const certification = attempt(() => rules.certificationDate({ office, contest }));
    if (certification !== null) {
      found.add(certification.citation);
    }
  }
}

/** Every distinct citation the module returns for contests from 2024 to 2030. */
function citations(rules: StateRules, fixtures: readonly RulesFixture[]): ReadonlySet<Citation> {
  const found = new Set<Citation>();
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year += 1) {
    for (const holiday of rules.holidays(year).holidays) {
      found.add(holiday.citation);
    }
  }
  const base = baseOffice(rules.state);
  for (const fixture of fixtures) {
    for (const contest of fixture.contests) {
      addOfficeCitations(found, rules, { ...base, ...contest.office, state: rules.state }, []);
    }
    for (const fixtureCase of fixture.cases) {
      addOfficeCitations(found, rules, { ...base, ...fixtureCase.office, state: rules.state }, [
        fixtureCase.contest,
      ]);
    }
  }
  const fixtureOffices = fixtures.flatMap((fixture) => [
    ...fixture.contests.map((contest) => contest.office),
    ...fixture.cases.map((fixtureCase) => fixtureCase.office),
  ]);
  const varied: readonly (readonly [keyof OfficeRef, readonly unknown[]])[] = [
    ['jurisdictionKind', JURISDICTION_KINDS],
    ['partisan', PARTISAN],
    ['population', POPULATIONS],
    ['templateKey', ['', ...new Set(fixtureOffices.map((office) => office.templateKey))]],
  ];
  // The rules are pure, so a field they did not read cannot change what they return: each office
  // branches only on the varied fields its own evaluation read, and each of those is varied once.
  const visit = (office: OfficeRef, done: ReadonlySet<string>): void => {
    const read = new Set<string>();
    addOfficeCitations(found, rules, recording(office, read), []);
    const next = varied.find(([field]) => read.has(field) && !done.has(field));
    if (next === undefined) {
      return;
    }
    const [field, values] = next;
    const nextDone = new Set([...done, field]);
    for (const value of values) {
      visit({ ...office, [field]: value }, nextDone);
    }
  };
  const typeIds = new Set([
    ...OFFICE_TYPE_IDS,
    ...fixtureOffices.map((office) => office.officeTypeId),
    UNNAMED_TYPE,
  ]);
  for (const officeTypeId of typeIds) {
    for (const schedule of rules.schedules) {
      for (const trackSet of rules.trackSets) {
        visit({ ...base, officeTypeId, schedule, trackSet }, new Set());
      }
    }
  }
  return found;
}

describe('citation quotes', () => {
  it('read the limit from the field meta row schema', () => {
    expect(QUOTE_LIMIT).toBe(2000);
    expect(OFFICE_TYPE_IDS.length).toBeGreaterThan(0);
  });

  for (const [rules, fixtures] of MODULES) {
    it(`fit a field meta row in ${rules.state} from ${String(FIRST_YEAR)} to ${String(LAST_YEAR)}`, () => {
      const found = [...citations(rules, fixtures)];
      expect(found.length).toBeGreaterThan(0);
      const tooLong = found
        .filter((citation) => citation.quote.length > (QUOTE_LIMIT ?? 0))
        .map((citation) => `${citation.citation} (${String(citation.quote.length)} characters)`);
      expect(tooLong).toEqual([]);
    }, 30_000);
  }
});
