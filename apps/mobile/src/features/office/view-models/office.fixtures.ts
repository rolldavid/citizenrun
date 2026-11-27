import type {
  CandidacyView,
  ElectionView,
  FieldMeta,
  FilingTrack,
  OfficeDetail,
  PersonSummary,
} from '@citizenrun/shared';

import type { OfficeFieldReport, OfficeReadyData, OfficeViewModel } from './office.types';

// SCR-office-slug's states. Every office, place and person here is invented: the County Treasurer
// of Fixture Wren County in the state ZZ, its holder Carol Wynn and the candidates Dana Okafor and
// Luis Marrero. The screens render them at 2026-11-15T17:00:00.000Z, so day counts stay fixed.

const noop = (): void => undefined;

const OFFICE_ID = '01890000-0000-7000-8000-000000000101';
const JURISDICTION_ID = '01890000-0000-7000-8000-000000000102';
const DISTRICT_ID = '01890000-0000-7000-8000-000000000103';
const ELECTION_ID = '01890000-0000-7000-8000-000000000104';
const TRACK_ID = '01890000-0000-7000-8000-000000000105';

const CHECKED_AT = '2026-11-09T15:00:00.000Z';
const PAY_SOURCE = 'https://wrencounty.example/budget-2026';
const FILING_SOURCE = 'https://wrencounty.example/elections/filing';
const BUDGET_SOURCE = 'https://wrencounty.example/budget-2024';
const CODE_SOURCE = 'https://wrencounty.example/code/treasurer';

function proof(
  sourceUrl: string,
  quote: string,
  confidence: 'high' | 'medium' = 'high',
): FieldMeta {
  return { sourceUrl, quote, confidence, checkedAt: CHECKED_AT, ruleCitation: null };
}

/** A proof at low confidence with no link and no quote. */
const LOW_NO_LINK: FieldMeta = {
  sourceUrl: null,
  quote: null,
  confidence: 'low',
  checkedAt: CHECKED_AT,
  ruleCitation: null,
};

function person(id: string, slug: string, name: string, party: string | null): PersonSummary {
  return {
    id,
    slug,
    name,
    party,
    photo: null,
    photoCredit: null,
    claimed: false,
    rosterOnly: false,
    retiredAt: null,
    viewer: { following: false },
  };
}

const CAROL_WYNN = person(
  '01890000-0000-7000-8000-000000000111',
  'carol-wynn',
  'Carol Wynn',
  'democratic',
);
const DANA_OKAFOR = person(
  '01890000-0000-7000-8000-000000000112',
  'dana-okafor',
  'Dana Okafor',
  null,
);
const LUIS_MARRERO = person(
  '01890000-0000-7000-8000-000000000113',
  'luis-marrero',
  'Luis Marrero',
  'republican',
);
const ADA_FERREIRA = person(
  '01890000-0000-7000-8000-000000000114',
  'ada-ferreira',
  'Ada Ferreira',
  'republican',
);
const BEN_HOLLOWAY = person(
  '01890000-0000-7000-8000-000000000115',
  'ben-holloway',
  'Ben Holloway',
  'democratic',
);

type Officeholder = OfficeDetail['officeholders'][number];

function holder(who: PersonSummary, since: string | null): Officeholder {
  return {
    person: who,
    seatLabel: null,
    since,
    seatUpNext: true,
    termLimited: null,
    notRunning: null,
    cashOnHandCents: null,
    cashAsOf: null,
    cashSourceUrl: null,
  };
}

const DEADLINE: NonNullable<OfficeDetail['filingDeadline']> = {
  date: '2026-11-27',
  time: '17:00',
  timezone: 'America/New_York',
};

const TRACK: FilingTrack = {
  id: TRACK_ID,
  track: 'nonpartisan',
  opensOn: '2026-11-02',
  closesOn: '2026-11-27',
  closesTime: '17:00',
  timezone: 'America/New_York',
  petitionOpens: null,
  petitionDue: null,
  feeCents: 5000,
  signatures: 25,
  whereToFile: 'File in person at the county clerk.',
  basis: 'both',
  sourceUrl: FILING_SOURCE,
  quote: 'Filing opens November 2 and closes at 5:00 pm on November 27.',
  ruleCitation: 'Fixture Code 10-1',
  confidence: 'high',
  checkedAt: CHECKED_AT,
  fieldMeta: {
    opensOn: proof(FILING_SOURCE, 'Filing opens November 2.'),
    closesOn: proof(FILING_SOURCE, 'Filing closes at 5:00 pm on November 27.'),
    closesTime: proof(FILING_SOURCE, 'Filing closes at 5:00 pm on November 27.'),
    feeCents: proof(FILING_SOURCE, 'The filing fee is $50.'),
    signatures: proof(FILING_SOURCE, 'A candidate files 25 signatures.'),
    whereToFile: proof(FILING_SOURCE, 'File in person at the county clerk.'),
  },
};

const ELECTION: ElectionView = {
  id: ELECTION_ID,
  officeId: OFFICE_ID,
  electionDate: '2027-04-06',
  electionDateMeta: proof(FILING_SOURCE, 'The general election is April 6, 2027.'),
  kind: 'general',
  party: null,
  turnoutClass: 'spring_local',
  filingOpens: '2026-11-02',
  filingDeadline: DEADLINE,
  petitionDue: null,
  deadlineBasis: 'both',
  deadlineConflict: null,
  filingStatus: 'open',
  tracks: [TRACK],
  candidatesCount: 0,
};

const OFFICE: OfficeDetail = {
  id: OFFICE_ID,
  slug: 'county-treasurer-wren',
  title: 'County Treasurer',
  officeTypeId: 'county-treasurer',
  level: 'county',
  electorate: 'public',
  state: 'ZZ',
  jurisdiction: {
    id: JURISDICTION_ID,
    name: 'Fixture Wren County',
    kind: 'county',
    state: 'ZZ',
    website: 'https://wrencounty.example',
    timezone: 'America/New_York',
  },
  district: {
    id: DISTRICT_ID,
    tileId: 101,
    name: 'Fixture Wren County',
    level: 'county',
    geometryQuality: 'exact',
  },
  outline: {
    svg: 'M0 0 L1000 0 L1000 1000 L0 1000 Z',
    bbox: [-8800000, 4200000, -8780000, 4220000],
  },
  placeholder: false,
  completeness: null,
  partisan: true,
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
  signaturesRequired: 25,
  filingFeeCents: 5000,
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
  nextElection: { id: ELECTION_ID, electionDate: '2027-04-06', kind: 'general', party: null },
  filingDeadline: DEADLINE,
  filingStatus: 'open',
  headlineIssueId: 'property-taxes',
  issues: [
    { issueId: 'property-taxes', relevance: 3 },
    { issueId: 'public-money', relevance: 2 },
    { issueId: 'corporate-subsidies', relevance: 1 },
  ],
  featuredOfficeholder: CAROL_WYNN,
  featuredHolderSince: '2019-01-01',
  openSeat: null,
  retiredAt: null,
  viewer: { following: false, bookmarked: false, running: false, declarationId: null },
  officeTypeName: 'County Treasurer',
  termYears: 4,
  termLimitTerms: null,
  electorateCount: null,
  benefits: ['health', 'retirement'],
  meetingTimes: ['daytime'],
  payChangeNote: null,
  termPayCents: 21160000,
  effectiveHourlyCents: 5087,
  whereToFile: 'File in person at the county clerk.',
  partySelection: null,
  eligibility: null,
  budget: {
    cents: 8400000000,
    year: 2024,
    meta: proof(BUDGET_SOURCE, 'The adopted budget for 2024 is $84,000,000.'),
  },
  powers: [
    {
      powerId: 'collect-property-taxes',
      name: 'Collects property taxes',
      description: 'Sends the tax bills and collects what is owed on every parcel in the county.',
      relevance: 3,
      quote: 'The treasurer shall collect all taxes levied on real property.',
      sourceUrl: CODE_SOURCE,
      confidence: 'high',
      checkedAt: CHECKED_AT,
      issueIds: ['property-taxes'],
    },
    {
      powerId: 'invest-county-funds',
      name: 'Invests county funds',
      description: 'Decides with the board where county money is held until it is spent.',
      relevance: 2,
      quote: 'The treasurer, with the board, shall invest funds not needed for current use.',
      sourceUrl: CODE_SOURCE,
      confidence: 'high',
      checkedAt: CHECKED_AT,
      issueIds: ['public-money'],
    },
    {
      powerId: 'report-tax-abatements',
      name: 'Reports tax abatements',
      description: 'Publishes the taxes forgiven under each abatement the board approves.',
      relevance: 1,
      quote: 'The treasurer shall report each abatement in the annual statement.',
      sourceUrl: CODE_SOURCE,
      confidence: 'medium',
      checkedAt: CHECKED_AT,
      issueIds: ['corporate-subsidies'],
    },
  ],
  issueRelevance: [
    { issueId: 'property-taxes', relevance: 3 },
    { issueId: 'public-money', relevance: 2 },
    { issueId: 'corporate-subsidies', relevance: 1 },
  ],
  headlineIssue: null,
  impactInputs: {
    issues: [],
    scale: null,
    pivot: null,
    termFactor: null,
    population: null,
    populationSource: null,
    label: null,
  },
  easeInputs: null,
  entrenched: null,
  decidedIn: null,
  lean: { points: null, basis: null, approximate: false },
  votesBasis: null,
  effort: null,
  nextElectionDetail: ELECTION,
  upcomingElections: [ELECTION],
  results: [],
  officeholders: [holder(CAROL_WYNN, '2019-01-01')],
  boardControl: null,
  candidates: [],
  candidatesCount: 0,
  declaredRunners: [],
  declaredRunnersCount: 0,
  changedAt: CHECKED_AT,
  fieldMeta: {
    payAnnualCents: proof(PAY_SOURCE, 'The treasurer is paid $52,900 a year.'),
    payKind: proof(PAY_SOURCE, 'The treasurer is paid a salary.'),
    payAmountCents: proof(PAY_SOURCE, 'The treasurer is paid $52,900 a year.'),
    payPeriod: proof(PAY_SOURCE, 'The treasurer is paid $52,900 a year.'),
    benefits: proof(PAY_SOURCE, 'The treasurer takes part in the health and retirement plans.'),
    hoursPerWeek: {
      sourceUrl: PAY_SOURCE,
      quote: null,
      confidence: 'low',
      checkedAt: CHECKED_AT,
      ruleCitation: null,
    },
    fullTime: proof(PAY_SOURCE, 'The position is part time.', 'medium'),
    meetingTimes: proof(PAY_SOURCE, 'The office is open on weekdays.', 'medium'),
    filingFeeCents: proof(FILING_SOURCE, 'The filing fee is $50.'),
    signaturesRequired: proof(FILING_SOURCE, 'A candidate files 25 signatures.'),
    whereToFile: proof(FILING_SOURCE, 'File in person at the county clerk.'),
    seats: proof(FILING_SOURCE, 'One treasurer is elected.'),
    seatsUpNext: proof(FILING_SOURCE, 'The office is on the 2027 ballot.'),
    termYears: proof(PAY_SOURCE, 'The term of office is four years.'),
    partisan: proof(FILING_SOURCE, 'Candidates are nominated by party.', 'medium'),
    filingDeadline: proof(FILING_SOURCE, 'Filing closes at 5:00 pm on November 27.'),
  },
};

const FIELD_REPORT_IDLE: OfficeFieldReport = {
  status: 'idle',
  errorCode: null,
  onSubmit: noop,
  onReset: noop,
};

/** The ready data every fixture but the generic states starts from. */
const officeReadyData: OfficeReadyData = {
  office: OFFICE,
  actions: {
    runState: 'hidden',
    runUnavailable: null,
    following: false,
    bookmarked: false,
    onRun: noop,
    onToggleFollow: noop,
    onToggleBookmark: noop,
  },
  issues: [
    {
      id: 'property-taxes',
      name: 'Property taxes and fair assessment',
      icon: 'property-taxes',
      sort: 6,
    },
    {
      id: 'corporate-subsidies',
      name: 'Corporate tax breaks and subsidies',
      icon: 'corporate-subsidies',
      sort: 5,
    },
    { id: 'public-money', name: 'Public money and divestment', icon: 'public-money', sort: 17 },
  ],
  signedIn: true,
  singleIssue: null,
  candidates: { entries: [], total: 0, onShowAll: null },
  officeholders: [
    {
      holder: holder(CAROL_WYNN, '2019-01-01'),
      entry: { person: CAROL_WYNN, href: '/c/carol-wynn', onToggleFollow: null },
    },
  ],
  mapRow: { onOpen: null },
  fieldReport: FIELD_REPORT_IDLE,
  onOpenSource: noop,
  onRefresh: noop,
};

function ready(data: OfficeReadyData, stale = false): OfficeViewModel {
  return { status: 'ready', data, refreshing: false, stale };
}

/** The ready data with the office changed. */
function withOffice(office: Partial<OfficeDetail>): OfficeReadyData {
  return { ...officeReadyData, office: { ...OFFICE, ...office } };
}

/** A proof map without the named entries. */
function without<T extends object>(map: T, keys: readonly (keyof T)[]): T {
  return Object.fromEntries(
    Object.entries(map).filter(([key]) => !keys.some((each) => each === key)),
  ) as T; // the entries of T less some keys, all of them optional
}

/** The office's proofs without the named ones. */
function fieldMetaWithout(...keys: (keyof OfficeDetail['fieldMeta'])[]): OfficeDetail['fieldMeta'] {
  return without(OFFICE.fieldMeta, keys);
}

/** The election, its track and the office's deadline moved to new filing dates. */
function filingDates(input: {
  opens: string;
  closes: string;
  status: OfficeDetail['filingStatus'];
}): Partial<OfficeDetail> {
  const deadline = { ...DEADLINE, date: input.closes };
  const election: ElectionView = {
    ...ELECTION,
    filingOpens: input.opens,
    filingDeadline: deadline,
    filingStatus: input.status,
    tracks: [{ ...TRACK, opensOn: input.opens, closesOn: input.closes }],
  };
  return {
    filingDeadline: deadline,
    filingStatus: input.status,
    nextElectionDetail: election,
    upcomingElections: [election],
  };
}

const PAY_UNKNOWN: Partial<OfficeDetail> = {
  payKind: null,
  payAmountCents: null,
  payAnnualCents: null,
  payPeriod: null,
  termPayCents: null,
  effectiveHourlyCents: null,
};

const NO_ELECTION: Partial<OfficeDetail> = {
  nextElection: null,
  filingDeadline: null,
  nextElectionDetail: null,
  upcomingElections: [],
  filingStatus: 'no_election',
};

function candidacy(
  id: string,
  who: PersonSummary,
  status: CandidacyView['status'],
  on: string,
  filedOn: string | null,
): CandidacyView {
  return {
    id,
    person: who,
    office: {
      id: OFFICE_ID,
      slug: OFFICE.slug,
      title: OFFICE.title,
      state: 'ZZ',
      jurisdictionName: OFFICE.jurisdiction.name,
      retiredAt: null,
    },
    electionId: ELECTION_ID,
    electionDate: '2027-04-06',
    electionKind: 'general',
    electionParty: null,
    party: who.party,
    status,
    statusHistory: [{ status, on, sourceUrl: FILING_SOURCE }],
    filedOn,
    sourceUrl: FILING_SOURCE,
  };
}

const LUIS_FILED = candidacy(
  '01890000-0000-7000-8000-000000000121',
  LUIS_MARRERO,
  'filed',
  '2026-11-12',
  '2026-11-12',
);
const DANA_COMMITTEE = candidacy(
  '01890000-0000-7000-8000-000000000122',
  DANA_OKAFOR,
  'committee_registered',
  '2026-10-28',
  null,
);

const LONG_TITLE =
  'Treasurer and Ex Officio Collector of Taxes, Fees and Assessments for the Consolidated Fixture County of Wren, Townships';
const LONG_PLACE = 'Fixture Consolidated County of Wren and the Lower Alder Vale';
const LONG_HOLDER = person(
  '01890000-0000-7000-8000-000000000116',
  'carolina-wynn-abernathy',
  'Carolina Wynn-Abernathy Featherstonehaugh de las Montgomerie',
  'democratic',
);
const LONG_WHERE_TO_FILE =
  'File in person at the office of the county clerk, on the second floor of the county building, ' +
  'between eight in the morning and five in the afternoon on any weekday while filing is open. Bring the ' +
  'signed declaration of candidacy, the petition with its signatures and the fee by check or a money order.';

const longNameData: OfficeReadyData = {
  ...withOffice({
    title: LONG_TITLE,
    jurisdiction: { ...OFFICE.jurisdiction, name: LONG_PLACE },
    district: { ...OFFICE.district, name: LONG_PLACE },
    featuredOfficeholder: LONG_HOLDER,
    officeholders: [holder(LONG_HOLDER, '2019-01-01')],
    whereToFile: LONG_WHERE_TO_FILE,
  }),
  officeholders: [
    {
      holder: holder(LONG_HOLDER, '2019-01-01'),
      entry: { person: LONG_HOLDER, href: '/c/carolina-wynn-abernathy', onToggleFollow: null },
    },
  ],
};

function withReport(report: Partial<OfficeFieldReport>): OfficeViewModel {
  return ready({ ...officeReadyData, fieldReport: { ...FIELD_REPORT_IDLE, ...report } });
}

const BOARD_HOLDERS = [
  holder(CAROL_WYNN, '2019-01-01'),
  holder(ADA_FERREIRA, '2021-01-01'),
  holder(BEN_HOLLOWAY, '2023-01-01'),
];

export const officeLoading: OfficeViewModel = { status: 'loading' };

export const officeError: OfficeViewModel = { status: 'error', code: 'internal', onRetry: noop };

export const officeOffline: OfficeViewModel = { status: 'offline', onRetry: noop };

export const officeStale: OfficeViewModel = ready(officeReadyData, true);

export const officeNotFound: OfficeViewModel = {
  status: 'error',
  code: 'not_found',
  onRetry: noop,
};

export const officeReady: OfficeViewModel = ready(officeReadyData);

export const officeSignedOut: OfficeViewModel = ready({
  ...withOffice({
    viewer: { following: false, bookmarked: false, running: false, declarationId: null },
  }),
  signedIn: false,
  fieldReport: null,
});

export const officeAllUnknown: OfficeViewModel = ready({
  ...withOffice({
    ...PAY_UNKNOWN,
    ...NO_ELECTION,
    filingStatus: 'dates_not_known',
    jurisdiction: { ...OFFICE.jurisdiction, website: null, timezone: null },
    outline: null,
    partisan: null,
    seatsUpNext: null,
    hoursPerWeek: null,
    fitsDayJob: null,
    fullTime: null,
    termYears: null,
    termLimitTerms: null,
    benefits: null,
    meetingTimes: null,
    payChangeNote: null,
    filingFeeCents: null,
    signaturesRequired: null,
    whereToFile: null,
    electorateCount: null,
    headlineIssueId: null,
    featuredOfficeholder: null,
    featuredHolderSince: null,
    budget: { cents: null, year: null, meta: null },
    powers: [],
    officeholders: [],
    fieldMeta: {},
  }),
  officeholders: [],
});

export const officePayNotKnown: OfficeViewModel = ready(
  withOffice({
    ...PAY_UNKNOWN,
    fieldMeta: fieldMetaWithout('payKind', 'payAmountCents', 'payAnnualCents', 'payPeriod'),
  }),
);

export const officeDeadlineNotKnown: OfficeViewModel = (() => {
  const trackMeta = without(TRACK.fieldMeta, ['opensOn', 'closesOn', 'closesTime']);
  const election: ElectionView = {
    ...ELECTION,
    filingOpens: null,
    filingDeadline: null,
    filingStatus: 'dates_not_known',
    tracks: [{ ...TRACK, opensOn: null, closesOn: null, closesTime: null, fieldMeta: trackMeta }],
  };
  return ready(
    withOffice({
      filingDeadline: null,
      filingStatus: 'dates_not_known',
      nextElectionDetail: election,
      upcomingElections: [election],
      fieldMeta: fieldMetaWithout('filingDeadline'),
    }),
  );
})();

export const officeLowConfidence: OfficeViewModel = ready(
  withOffice({
    fieldMeta: {
      ...OFFICE.fieldMeta,
      payAnnualCents: LOW_NO_LINK,
      payAmountCents: LOW_NO_LINK,
      filingFeeCents: LOW_NO_LINK,
    },
  }),
);

export const officeDeadlineConflict: OfficeViewModel = ready(
  withOffice({
    nextElectionDetail: {
      ...ELECTION,
      deadlineConflict: [
        {
          track: 'nonpartisan',
          field: 'closes_on',
          computed: { value: '2026-11-27', ruleCitation: 'Fixture Code 10-2' },
          scraped: {
            value: '2026-11-30',
            sourceUrl: 'https://elections.wrencounty.example/calendar',
            quote: 'Candidate filing closes November 30.',
            checkedAt: CHECKED_AT,
          },
        },
      ],
    },
  }),
);

export const officeDeadlineSoon: OfficeViewModel = ready(
  withOffice(filingDates({ opens: '2026-11-02', closes: '2026-11-20', status: 'open' })),
);

export const officeNotOpenYet: OfficeViewModel = ready(
  withOffice(filingDates({ opens: '2026-12-01', closes: '2026-12-15', status: 'not_open_yet' })),
);

export const officeClosed: OfficeViewModel = ready(
  withOffice(filingDates({ opens: '2026-10-19', closes: '2026-11-02', status: 'closed' })),
);

export const officeNoElection: OfficeViewModel = ready(
  withOffice({ ...NO_ELECTION, fieldMeta: fieldMetaWithout('filingDeadline') }),
);

export const officePlaceholder: OfficeViewModel = (() => {
  const election: ElectionView = {
    ...ELECTION,
    filingOpens: null,
    filingDeadline: null,
    filingStatus: 'dates_not_known',
    tracks: [],
  };
  return ready(
    withOffice({
      ...PAY_UNKNOWN,
      placeholder: true,
      hoursPerWeek: null,
      fitsDayJob: null,
      fullTime: null,
      benefits: null,
      meetingTimes: null,
      filingFeeCents: null,
      signaturesRequired: null,
      whereToFile: null,
      filingDeadline: null,
      filingStatus: 'dates_not_known',
      nextElectionDetail: election,
      upcomingElections: [election],
      powers: [],
      fieldMeta: fieldMetaWithout(
        'payKind',
        'payAmountCents',
        'payAnnualCents',
        'payPeriod',
        'benefits',
        'hoursPerWeek',
        'fullTime',
        'meetingTimes',
        'filingFeeCents',
        'signaturesRequired',
        'whereToFile',
        'filingDeadline',
      ),
    }),
  );
})();

export const officeMinimal: OfficeViewModel = ready(
  withOffice({
    ...PAY_UNKNOWN,
    completeness: 'minimal',
    filingFeeCents: null,
    whereToFile: null,
    fieldMeta: fieldMetaWithout(
      'payKind',
      'payAmountCents',
      'payAnnualCents',
      'payPeriod',
      'filingFeeCents',
      'whereToFile',
    ),
  }),
);

export const officeRetired: OfficeViewModel = ready(
  withOffice({ retiredAt: '2026-10-01T00:00:00.000Z' }),
);

export const officeBoard: OfficeViewModel = ready({
  ...withOffice({
    seats: 1,
    bodySize: 7,
    seatsUpNext: 3,
    boardControl: {
      seats: 1,
      bodySize: 7,
      seatsUpNext: 3,
      majority: 4,
      partySplit: [
        { party: 'democratic', count: 4 },
        { party: 'republican', count: 3 },
      ],
    },
    officeholders: BOARD_HOLDERS,
  }),
  officeholders: BOARD_HOLDERS.map((each) => ({
    holder: each,
    entry: { person: each.person, href: `/c/${each.person.slug}`, onToggleFollow: null },
  })),
});

export const officeApproximate: OfficeViewModel = ready(
  withOffice({ district: { ...OFFICE.district, geometryQuality: 'county_approx' } }),
);

export const officeMembersOnly: OfficeViewModel = ready(
  withOffice({
    title: 'Cooperative Board Trustee',
    officeTypeId: 'coop-board',
    officeTypeName: 'Cooperative Board Trustee',
    partisan: false,
    electorate: 'members',
    electorateCount: 31000,
    jurisdiction: {
      ...OFFICE.jurisdiction,
      name: 'Fixture Wren Electric Cooperative',
      kind: 'coop',
    },
  }),
);

export const officePartySelection: OfficeViewModel = ready(
  withOffice({
    ...NO_ELECTION,
    title: 'Precinct Committee Member',
    officeTypeId: 'party-precinct-committee',
    officeTypeName: 'Precinct Committee Member',
    electorate: 'party',
    partySelection: 'caucus',
    fieldMeta: {
      ...fieldMetaWithout('filingDeadline'),
      partySelection: proof(FILING_SOURCE, 'Precinct committee members are chosen at the caucus.'),
    },
  }),
);

export const officeCandidates: OfficeViewModel = ready({
  ...withOffice({
    candidates: [LUIS_FILED, DANA_COMMITTEE],
    candidatesCount: 3,
    nextElectionDetail: { ...ELECTION, candidatesCount: 3 },
    upcomingElections: [{ ...ELECTION, candidatesCount: 3 }],
  }),
  candidates: {
    entries: [LUIS_FILED, DANA_COMMITTEE].map((each) => ({
      candidacy: each,
      entry: { person: each.person, href: `/c/${each.person.slug}`, onToggleFollow: null },
    })),
    total: 3,
    onShowAll: noop,
  },
});

export const officeTwoActions: OfficeViewModel = ready({
  ...withOffice({
    viewer: { following: true, bookmarked: true, running: false, declarationId: null },
  }),
  actions: { ...officeReadyData.actions, following: true, bookmarked: true },
});

export const officeSingleIssue: OfficeViewModel = ready({
  ...withOffice({ impactMode: 'single_issue', impactIssueId: 'property-taxes' }),
  singleIssue: { issueId: 'property-taxes', onSelect: noop },
});

export const officeLongName: OfficeViewModel = ready(longNameData);

export const officeTextScale: OfficeViewModel = ready(longNameData);

export const officeReportSending: OfficeViewModel = withReport({ status: 'sending' });

export const officeReportSent: OfficeViewModel = withReport({ status: 'sent' });

export const officeReportError: OfficeViewModel = withReport({
  status: 'error',
  errorCode: 'account_too_new',
});

export const officeReportLinkInvalid: OfficeViewModel = withReport({
  status: 'error',
  errorCode: 'link_invalid',
});
