import type { RulesFixture } from '../../types.ts';
import { COUNTY_CHAIR, PARTISAN_OFFICES, PRECINCT_CHAIR } from './offices.ts';

/** Each party's primary, each party's runoff primary and the general, as the calendar dates them. */
const CONTESTS = [
  { date: '2026-03-03', kind: 'primary', party: 'democratic' },
  { date: '2026-03-03', kind: 'primary', party: 'republican' },
  { date: '2026-05-26', kind: 'primary_runoff', party: 'democratic' },
  { date: '2026-05-26', kind: 'primary_runoff', party: 'republican' },
  { date: '2026-11-03', kind: 'general', party: null },
] as const;

const ELECTION_DATES =
  'Tuesday, March 3, 2026 | Primary election day. [Sec. 41.007(a)] … Tuesday, May 26, 2026 | Runoff primary election day. [Sec. 41.007(b)] … Tuesday, November 3, 2026 | General election day. [Sec. 41.002]';
const PARTY_PRIMARY =
  'Saturday, November 8, 2025 | First day the Republican or Democratic Party candidate may file an application for a place on the primary ballot. [Sec. 172.023(b)] … Monday, December 8, 2025 | Last day Democratic or Republican Party candidates may file an application for a place on the primary ballot (6 p.m.). [Sec. 172.023(a)]';
const NOVEMBER_8 =
  'Saturday, November 8, 2025 | First day the Republican or Democratic Party candidate may file an application for a place on the primary ballot. [Sec. 172.023(b)] First day the county chairs may accept applications for a place on the primary ballot for the office of county chair. [Sec. 172.023(b)] First day independent candidates may file a declaration of intent to run. [Secs. 142.002(b)(2), 172.023]';
const DECEMBER_8_CHAIRS =
  'Monday, December 8, 2025 | Last day the county chairs may accept applications for the office of county or precinct chair (6 p.m.). [Sec. 172.023(a)] Last day independent candidates may file a declaration of intent to run (6 p.m.). [Secs. 142.002, 172.023(a)]';
const INDEPENDENT = `${NOVEMBER_8} … ${DECEMBER_8_CHAIRS} … Wednesday, March 4, 2026 | First day independent candidates for offices not involved in runoff primary election may collect signatures for petitions in connection with applications. [Sec. 142.009] … Thursday, June 25, 2026 | Last day independent candidates may file applications and petitions (5 p.m.). [Sec. 142.006]`;
const PRECINCT_CHAIR_FILING = `Tuesday, September 9, 2025 | First day the county chairs may accept applications for a place on the ballot, for the office of precinct chair. [Sec. 172.023(b)] … ${DECEMBER_8_CHAIRS}`;
const COUNTY_CHAIR_FILING = `${NOVEMBER_8} … ${DECEMBER_8_CHAIRS}`;

const PRIMARY = {
  date: '2026-03-03',
  kind: 'primary',
  party: 'republican',
} as const;
const GENERAL = { date: '2026-11-03', kind: 'general', party: null } as const;

export const fixture: RulesFixture = {
  state: 'TX',
  source: {
    title: 'Important Dates for the Party Conventions, Primary Elections and General Election',
    url: 'https://www.sos.texas.gov/elections/candidates/guide/2026/dates2026.shtml',
    retrievedOn: '2026-11-27',
    sha256: 'd587fd02f711b4d39467df90fa6232665cc0de4c69fc45515883cdb19a8795cd',
  },
  contests: [
    {
      id: 'tx-2026-state-representative-contests',
      office: PARTISAN_OFFICES.stateRepresentative,
      year: 2026,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
    {
      id: 'tx-2026-sheriff-contests',
      office: PARTISAN_OFFICES.sheriff,
      year: 2026,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
  ],
  cases: [
    ...Object.entries(PARTISAN_OFFICES).flatMap(([name, office]) => [
      {
        id: `tx-2026-${name}-party-primary`,
        office,
        contest: PRIMARY,
        expect: [
          {
            track: 'party_primary' as const,
            opensOn: '2025-11-08',
            closesOn: '2025-12-08',
            closesTime: '18:00',
          },
        ],
        quote: PARTY_PRIMARY,
      },
      {
        id: `tx-2026-${name}-independent`,
        office,
        contest: GENERAL,
        expect: [
          {
            track: 'independent' as const,
            opensOn: '2025-11-08',
            closesOn: '2025-12-08',
            closesTime: '18:00',
            petitionOpens: '2026-03-04',
            petitionDue: '2026-06-25',
          },
        ],
        quote: INDEPENDENT,
      },
    ]),
    {
      id: 'tx-2026-precinct-chair',
      office: PRECINCT_CHAIR,
      contest: PRIMARY,
      expect: [
        {
          track: 'party_primary',
          opensOn: '2025-09-09',
          closesOn: '2025-12-08',
          closesTime: '18:00',
        },
      ],
      quote: PRECINCT_CHAIR_FILING,
    },
    {
      id: 'tx-2026-county-chair',
      office: COUNTY_CHAIR,
      contest: PRIMARY,
      expect: [
        {
          track: 'party_primary',
          opensOn: '2025-11-08',
          closesOn: '2025-12-08',
          closesTime: '18:00',
        },
      ],
      quote: COUNTY_CHAIR_FILING,
    },
  ],
};
