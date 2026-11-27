import type { RulesFixture } from '../../types.ts';
import { COUNTY_CHAIR, PARTISAN_OFFICES, PRECINCT_CHAIR } from './offices.ts';

/** Each party's primary, each party's runoff primary and the general, as the page dates them. */
const CONTESTS = [
  { date: '2028-03-07', kind: 'primary', party: 'democratic' },
  { date: '2028-03-07', kind: 'primary', party: 'republican' },
  { date: '2028-05-23', kind: 'primary_runoff', party: 'democratic' },
  { date: '2028-05-23', kind: 'primary_runoff', party: 'republican' },
  { date: '2028-11-07', kind: 'general', party: null },
] as const;

const ELECTION_DATES =
  'Tuesday, March 7, 2028 - Primary Election … Tuesday, May 23, 2028 – Primary Runoff Election … Tuesday, November 7, 2028 - Uniform Election Date';
const OPENS =
  'First day to file for all other candidates for offices that are regularly scheduled to be on the Primary ballot; first day for independent candidates to file declaration of intent. | Saturday, November 13, 2027';
const CLOSES =
  'Filing deadline for primary candidates; filing deadline for independent candidates to file declaration of intent. | Monday, December 13, 2027 at 6:00 PM';
const PRECINCT_CHAIR_OPENS =
  'First day to file for a place on the Primary ballot for precinct chair candidates. | Tuesday, September 14, 2027';

const PRIMARY = {
  date: '2028-03-07',
  kind: 'primary',
  party: 'republican',
} as const;
const GENERAL = { date: '2028-11-07', kind: 'general', party: null } as const;

const OFFICES = {
  stateRepresentative: PARTISAN_OFFICES.stateRepresentative,
  usHouse: PARTISAN_OFFICES.usHouse,
  sheriff: PARTISAN_OFFICES.sheriff,
  countyCommissioner: PARTISAN_OFFICES.countyCommissioner,
};

export const fixture: RulesFixture = {
  state: 'TX',
  source: {
    title: 'Important Election Dates',
    url: 'https://www.sos.texas.gov/elections/voter/important-election-dates.shtml',
    retrievedOn: '2026-11-27',
    sha256: '388a64355b101abc1d02b0add0a9eee0b4806e93dc424b746176b1e0436aa8f4',
  },
  contests: [
    {
      id: 'tx-2028-state-representative-contests',
      office: PARTISAN_OFFICES.stateRepresentative,
      year: 2028,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
    {
      id: 'tx-2028-sheriff-contests',
      office: PARTISAN_OFFICES.sheriff,
      year: 2028,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
  ],
  cases: [
    ...Object.entries(OFFICES).flatMap(([name, office]) => [
      {
        id: `tx-2028-${name}-party-primary`,
        office,
        contest: PRIMARY,
        expect: [
          {
            track: 'party_primary' as const,
            opensOn: '2027-11-13',
            closesOn: '2027-12-13',
            closesTime: '18:00',
          },
        ],
        quote: `${OPENS} … ${CLOSES}`,
      },
      {
        id: `tx-2028-${name}-independent`,
        office,
        contest: GENERAL,
        expect: [
          {
            track: 'independent' as const,
            opensOn: '2027-11-13',
            closesOn: '2027-12-13',
            closesTime: '18:00',
          },
        ],
        quote: `${OPENS} … ${CLOSES}`,
      },
    ]),
    {
      id: 'tx-2028-precinct-chair',
      office: PRECINCT_CHAIR,
      contest: PRIMARY,
      expect: [
        {
          track: 'party_primary',
          opensOn: '2027-09-14',
          closesOn: '2027-12-13',
          closesTime: '18:00',
        },
      ],
      quote: `${PRECINCT_CHAIR_OPENS} … ${CLOSES}`,
    },
    {
      id: 'tx-2028-county-chair',
      office: COUNTY_CHAIR,
      contest: PRIMARY,
      expect: [
        {
          track: 'party_primary',
          opensOn: '2027-11-13',
          closesOn: '2027-12-13',
          closesTime: '18:00',
        },
      ],
      quote: `${OPENS} … ${CLOSES}`,
    },
  ],
};
