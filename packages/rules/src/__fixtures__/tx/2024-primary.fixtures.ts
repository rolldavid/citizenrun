import type { RulesFixture } from '../../types.ts';
import { COUNTY_CHAIR, PARTISAN_OFFICES, PRECINCT_CHAIR } from './offices.ts';

/** Each party's primary, each party's runoff primary and the general, as the calendar dates them. */
const CONTESTS = [
  { date: '2024-03-05', kind: 'primary', party: 'democratic' },
  { date: '2024-03-05', kind: 'primary', party: 'republican' },
  { date: '2024-05-28', kind: 'primary_runoff', party: 'democratic' },
  { date: '2024-05-28', kind: 'primary_runoff', party: 'republican' },
  { date: '2024-11-05', kind: 'general', party: null },
] as const;

const ELECTION_DATES =
  'March 5, 2024 | Primary election day. TEC § 41.007(a). … May 28, 2024 | Runoff primary election day. TEC § 41.007(b). … November 5, 2024 | General election day. TEC § 41.002.';
const NOVEMBER_11 =
  'November 11, 2023 | First day the Republican or Democratic Party candidate may file an application for a place on the primary ballot. TEC § 172.023(b). First day the county chairs may accept applications for a place on the primary ballot for the office of county chair. TEC § 172.023(b). First day independent candidates may file a declaration of intent to run. TEC §§ 142.002(b), 172.023.';
const DECEMBER_11 =
  'December 11, 2023 | Last day Democratic or Republican Party candidates may file an application for a place on the primary ballot (6 p.m.). TEC § 172.023(a).';
const DECEMBER_11_CHAIRS =
  'Last day the county chairs may accept applications for the office of county or precinct chair (6 p.m.). TEC § 172.023(a). Last day independent candidates may file a declaration of intent to run (6 p.m.). TEC §§ 142.002, 172.023(a).';
const PARTY_PRIMARY = `${NOVEMBER_11} … ${DECEMBER_11}`;
const INDEPENDENT = `${NOVEMBER_11} … ${DECEMBER_11} … ${DECEMBER_11_CHAIRS} … March 6, 2024 | First day independent candidates for offices not involved in runoff primary election may collect signatures for petitions in connection with applications. TEC § 142.009. … June 27, 2024 | Last day independent candidates may file applications and petitions (5 p.m.). TEC § 142.006.`;
const PRECINCT_CHAIR_FILING = `September 12, 2023 | First day the county chairs may accept applications for a place on the ballot, for the office of precinct chair. TEC § 172.023(b). … ${DECEMBER_11} … ${DECEMBER_11_CHAIRS}`;
const COUNTY_CHAIR_FILING = `${NOVEMBER_11} … ${DECEMBER_11} … ${DECEMBER_11_CHAIRS}`;

const PRIMARY = {
  date: '2024-03-05',
  kind: 'primary',
  party: 'democratic',
} as const;
const GENERAL = { date: '2024-11-05', kind: 'general', party: null } as const;

const OFFICES = {
  stateRepresentative: PARTISAN_OFFICES.stateRepresentative,
  usSenate: PARTISAN_OFFICES.usSenate,
  sheriff: PARTISAN_OFFICES.sheriff,
  constable: PARTISAN_OFFICES.constable,
};

export const fixture: RulesFixture = {
  state: 'TX',
  source: {
    title: 'Important Dates for the Party Conventions, Primary Elections and General Election',
    url: 'https://www.sos.texas.gov/elections/candidates/guide/2024/dates2024.shtml',
    retrievedOn: '2026-11-27',
    sha256: '553fb72426ce975310b1e061678baaad28d1fa6b5a35887b652fec0d201d56df',
  },
  contests: [
    {
      id: 'tx-2024-state-representative-contests',
      office: PARTISAN_OFFICES.stateRepresentative,
      year: 2024,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
    {
      id: 'tx-2024-sheriff-contests',
      office: PARTISAN_OFFICES.sheriff,
      year: 2024,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
  ],
  cases: [
    ...Object.entries(OFFICES).flatMap(([name, office]) => [
      {
        id: `tx-2024-${name}-party-primary`,
        office,
        contest: PRIMARY,
        expect: [
          {
            track: 'party_primary' as const,
            opensOn: '2023-11-11',
            closesOn: '2023-12-11',
            closesTime: '18:00',
          },
        ],
        quote: PARTY_PRIMARY,
      },
      {
        id: `tx-2024-${name}-independent`,
        office,
        contest: GENERAL,
        expect: [
          {
            track: 'independent' as const,
            opensOn: '2023-11-11',
            closesOn: '2023-12-11',
            closesTime: '18:00',
            petitionOpens: '2024-03-06',
            petitionDue: '2024-06-27',
          },
        ],
        quote: INDEPENDENT,
      },
    ]),
    {
      id: 'tx-2024-precinct-chair',
      office: PRECINCT_CHAIR,
      contest: PRIMARY,
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-09-12',
          closesOn: '2023-12-11',
          closesTime: '18:00',
        },
      ],
      quote: PRECINCT_CHAIR_FILING,
    },
    {
      id: 'tx-2024-county-chair',
      office: COUNTY_CHAIR,
      contest: PRIMARY,
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-11-11',
          closesOn: '2023-12-11',
          closesTime: '18:00',
        },
      ],
      quote: COUNTY_CHAIR_FILING,
    },
  ],
};
