import type { FieldMeta, OfficeSummary, PersonSummary } from '@citizenrun/shared';
import type { CardContext, FeedCanvasOptions } from '../feed.ts';
import type { RunAgainstData } from '../model/run-against.ts';

// CARD-tests: the office fixtures of the run-against canvas and the office hero. Every person and
// place here is invented: place names start with "Fixture", and ZZ is no state.

/** The fixed instant every fixture is built at: 9 am on November 15, 2026 in the fixture county. */
export const FIXTURE_NOW = new Date('2026-11-15T17:00:00Z');
export const FIXTURE_CTX: CardContext = { locale: 'en', now: FIXTURE_NOW };
/** The options of a canvas with the photo slot off: every card draws the illustration. */
export const NO_PHOTO_OPTIONS: FeedCanvasOptions = {
  stickerAllowed: false,
  photoHrefFor: () => null,
};

const CHECKED_AT = '2026-11-09T15:00:00Z';

const CAROL_WYNN: PersonSummary = {
  id: 'fixture-person-1',
  slug: 'fixture-carol-wynn',
  name: 'Carol Wynn',
  party: null,
  photo: null,
  photoCredit: null,
  claimed: false,
  rosterOnly: false,
  retiredAt: null,
  viewer: { following: false },
};

const DANA_OKAFOR: PersonSummary = {
  ...CAROL_WYNN,
  id: 'fixture-person-2',
  slug: 'fixture-dana-okafor',
  name: 'Dana Okafor',
};

/** A proof at low confidence, which has no link and no quote. */
const LOW_PROOF: FieldMeta = {
  sourceUrl: null,
  quote: null,
  confidence: 'low',
  checkedAt: CHECKED_AT,
  ruleCitation: null,
};

/** The County Treasurer of Fixture Wren County, ZZ: every act-on value known. */
export const FIXTURE_OFFICE: OfficeSummary = {
  id: 'fixture-office-1',
  slug: 'fixture-county-treasurer',
  title: 'County Treasurer',
  officeTypeId: 'county-treasurer',
  level: 'county',
  electorate: 'public',
  state: 'ZZ',
  jurisdiction: {
    id: 'fixture-jurisdiction-1',
    name: 'Fixture Wren County',
    kind: 'county',
    state: 'ZZ',
    website: null,
    timezone: 'America/Los_Angeles',
  },
  district: {
    id: 'fixture-district-1',
    tileId: 1,
    name: 'Fixture Wren County',
    level: 'county',
    geometryQuality: 'exact',
  },
  outline: null,
  placeholder: false,
  completeness: null,
  partisan: false,
  seats: 1,
  bodySize: null,
  seatsUpNext: 1,
  payAnnualCents: 5290000,
  payKind: 'salary',
  payAmountCents: 5290000,
  payPeriod: 'year',
  hoursPerWeek: 20,
  fitsDayJob: 'likely',
  fullTime: false,
  signaturesRequired: null,
  filingFeeCents: 5000,
  costToRunCents: null,
  ease: null,
  easeConfidence: null,
  impact: null,
  impactMode: 'personal',
  impactIssueId: null,
  opportunity: null,
  votesToWin: 2100,
  votesLow: 1800,
  votesHigh: 2400,
  votesEstimated: true,
  nextElection: {
    id: 'fixture-election-1',
    electionDate: '2027-04-06',
    kind: 'general',
    party: null,
  },
  filingDeadline: { date: '2026-11-27', time: null, timezone: 'America/Los_Angeles' },
  filingStatus: 'open',
  headlineIssueId: 'property-taxes',
  issues: [
    { issueId: 'property-taxes', relevance: 3 },
    { issueId: 'public-money', relevance: 2 },
  ],
  featuredOfficeholder: CAROL_WYNN,
  featuredHolderSince: '2019-01-07',
  openSeat: null,
  fieldMeta: {
    payAnnualCents: {
      sourceUrl: 'https://elections.wrencounty.example/budget-2026',
      quote: 'The treasurer is paid $52,900 a year.',
      confidence: 'high',
      checkedAt: CHECKED_AT,
      ruleCitation: null,
    },
    hoursPerWeek: LOW_PROOF,
    filingDeadline: {
      sourceUrl: 'https://elections.wrencounty.example/calendar',
      quote: 'Filing closes November 27.',
      confidence: 'medium',
      checkedAt: CHECKED_AT,
      ruleCitation: null,
    },
  },
  retiredAt: null,
  viewer: { following: false, bookmarked: false, running: false, declarationId: null },
};

/** The data of a canvas for an office: its featured officeholder is the holder shown. */
function dataFor(office: OfficeSummary): RunAgainstData {
  return { office, featuredPerson: office.featuredOfficeholder, lastResult: null };
}

/** The run-against canvas: one fixture per state of the card. */
export const RUN_AGAINST_FIXTURES: Readonly<
  Record<
    'known' | 'allUnknown' | 'lowConfidence' | 'longTitle' | 'titleNotDrawable',
    RunAgainstData
  >
> = {
  known: dataFor(FIXTURE_OFFICE),
  // Every act-on value null. The election stays, so the canvas keeps its election line.
  allUnknown: dataFor({
    ...FIXTURE_OFFICE,
    payAnnualCents: null,
    payKind: null,
    payAmountCents: null,
    payPeriod: null,
    hoursPerWeek: null,
    fitsDayJob: null,
    fullTime: null,
    filingFeeCents: null,
    votesToWin: null,
    votesLow: null,
    votesHigh: null,
    votesEstimated: null,
    filingDeadline: null,
    filingStatus: 'dates_not_known',
    featuredOfficeholder: null,
    featuredHolderSince: null,
    headlineIssueId: null,
    issues: [],
    fieldMeta: {},
  }),
  // The pay and the filing deadline at low confidence: each figure takes the estimate word.
  lowConfidence: dataFor({
    ...FIXTURE_OFFICE,
    fieldMeta: {
      ...FIXTURE_OFFICE.fieldMeta,
      payAnnualCents: LOW_PROOF,
      filingDeadline: LOW_PROOF,
    },
  }),
  // A 60-character title: four lines, the last one cut.
  longTitle: dataFor({
    ...FIXTURE_OFFICE,
    title: 'Fixture Regional Water and Sanitation District Board Members',
    officeTypeId: 'water-district-board',
  }),
  // A title with a character no face of a canvas has: the office type's short name is drawn.
  titleNotDrawable: dataFor({ ...FIXTURE_OFFICE, title: 'Fixture Treasurer of Kaʻū' }),
};

/** The office hero: its least height, and a text column long enough to grow it. */
export const OFFICE_HERO_FIXTURES: Readonly<
  Record<'twoLineTitle' | 'growsWithHolder', RunAgainstData>
> = {
  twoLineTitle: dataFor(FIXTURE_OFFICE),
  growsWithHolder: dataFor({
    ...FIXTURE_OFFICE,
    title: 'Fixture Public Utility District Commissioner',
    officeTypeId: 'public-power-board',
    jurisdiction: {
      ...FIXTURE_OFFICE.jurisdiction,
      name: 'Fixture Alder Public Utility District',
      kind: 'special_district',
    },
    featuredOfficeholder: DANA_OKAFOR,
    featuredHolderSince: '2021-01-04',
  }),
};
