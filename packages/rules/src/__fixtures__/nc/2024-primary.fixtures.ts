import type { RulesFixture } from '../../types.ts';
import { casesFor, COUNCIL_OF_STATE, OTHER_PARTISAN, SCHOOL_BOARD, US_HOUSE } from './offices.ts';

/** Each party's primary, each party's second primary and the general, as the guide dates them. */
const CONTESTS = [
  { date: '2024-03-05', kind: 'primary', party: 'democratic' },
  { date: '2024-03-05', kind: 'primary', party: 'green' },
  { date: '2024-03-05', kind: 'primary', party: 'libertarian' },
  { date: '2024-03-05', kind: 'primary', party: 'republican' },
  { date: '2024-05-14', kind: 'primary_runoff', party: 'democratic' },
  { date: '2024-05-14', kind: 'primary_runoff', party: 'green' },
  { date: '2024-05-14', kind: 'primary_runoff', party: 'libertarian' },
  { date: '2024-05-14', kind: 'primary_runoff', party: 'republican' },
  { date: '2024-11-05', kind: 'general', party: null },
] as const;

const ELECTION_DATES =
  'The date of the general election is Tuesday, November 5, 2024. To determine a political party’s nominee for certain contests, there is a primary election on Tuesday, March 5, 2024. If no candidate wins the first primary under the provisions of G.S. § 163-111, there may be a second primary for that contest on Tuesday, May 14, 2024.';
const WINDOW =
  'Filing for contests subject to party nomination begins at noon on Monday, December 4, 2023, and ends at noon on Friday, December 15, 2023.';
const WITHDRAWAL = 'Last Day to Withdraw as a Candidate G.S. § 163-106.4 12/12/2023 (5 p.m.)';
const COUNTY_FILERS =
  'Candidates for State Senator, Member of the State House of Representative, and all county offices must file their notice of candidacy with their county board of elections.';
const BOARD_OF_EDUCATION = 'County Offices such as County Commissioner, Board of Education, etc.';

const FILING = {
  opensOn: '2023-12-04',
  closesOn: '2023-12-15',
  closesTime: '12:00',
  withdrawalDeadline: '2023-12-12',
} as const;

// No U.S. Senate seat was on the 2024 ballot.
export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'A Candidate’s Guide to the 2024 Statewide Primary and General Election',
    url: 'https://dl.ncsbe.gov/Candidate%20Filing/2024_Candidates_Guide_Statewide_Primary_and_General_Elections.pdf',
    retrievedOn: '2026-11-27',
    sha256: '3fd09cefada0bfba26cb5b3b987b2bb0dd0632ef48c416e41bb18a3d46341c55',
  },
  contests: [
    {
      id: 'nc-2024-state-representative-contests',
      office: { ...OTHER_PARTISAN.stateRepresentative, staggerGroup: null, termYears: 2 },
      year: 2024,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
    {
      id: 'nc-2024-county-commissioner-contests',
      office: { ...OTHER_PARTISAN.countyCommissioner, staggerGroup: null, termYears: 2 },
      year: 2024,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
  ],
  cases: [
    ...casesFor(
      'nc-2024',
      { ...COUNCIL_OF_STATE, usHouse: US_HOUSE, ...OTHER_PARTISAN },
      { date: '2024-03-05', kind: 'primary', party: 'democratic' },
      { track: 'party_primary', ...FILING },
      `${WINDOW} … ${WITHDRAWAL} … ${ELECTION_DATES}`,
    ),
    {
      id: 'nc-2024-board-of-education',
      office: SCHOOL_BOARD,
      contest: { date: '2024-03-05', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', ...FILING }],
      quote: `${WITHDRAWAL} … ${COUNTY_FILERS} … ${WINDOW} … ${BOARD_OF_EDUCATION}`,
    },
  ],
};
