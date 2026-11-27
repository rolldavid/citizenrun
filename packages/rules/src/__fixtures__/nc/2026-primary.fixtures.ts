import type { RulesFixture } from '../../types.ts';
import { casesFor, OTHER_PARTISAN, SCHOOL_BOARD, US_HOUSE, US_SENATE } from './offices.ts';

/** Each party's primary, each party's second primary and the general, as the guide dates them. */
const CONTESTS = [
  { date: '2026-03-03', kind: 'primary', party: 'democratic' },
  { date: '2026-03-03', kind: 'primary', party: 'green' },
  { date: '2026-03-03', kind: 'primary', party: 'libertarian' },
  { date: '2026-03-03', kind: 'primary', party: 'republican' },
  { date: '2026-05-12', kind: 'primary_runoff', party: 'democratic' },
  { date: '2026-05-12', kind: 'primary_runoff', party: 'green' },
  { date: '2026-05-12', kind: 'primary_runoff', party: 'libertarian' },
  { date: '2026-05-12', kind: 'primary_runoff', party: 'republican' },
  { date: '2026-11-03', kind: 'general', party: null },
] as const;

const ELECTION_DATES =
  'The date of the general election is Tuesday, November 3, 2026. To determine the nominee for certain contests, there is a primary election on Tuesday, March 3, 2026. If no candidate wins the first primary under the provisions of G.S. § 163-111, there may be a second primary for that contest on Tuesday, May 12, 2026.';
const WINDOW =
  'Filing for contests subject to party nomination begins at noon on Monday, December 1, 2025, and ends at noon on Friday, December 19, 2025.';
const WITHDRAWAL =
  'Last Day to Withdraw as a Candidate Entitled to a Refund G.S. § 163-106.4 12/16/2025';
const COUNTY_FILERS =
  'Candidates for offices of State Senator, State House Representative, and all county and local offices must file their notice of candidacy with their county board of elections.';
const BOARD_OF_EDUCATION = 'County Offices such as County Commissioner, Board of Education, etc.';

const FILING = {
  opensOn: '2025-12-01',
  closesOn: '2025-12-19',
  closesTime: '12:00',
  withdrawalDeadline: '2025-12-16',
} as const;

// The Council of State is not elected in 2026.
export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'A Candidate’s Guide to the 2025-26 Statewide Primary and General Elections',
    url: 'https://dl.ncsbe.gov/Candidate%20Filing/2025-26%20Statewide%20Candidate%20Guide.pdf',
    retrievedOn: '2026-11-27',
    sha256: 'acb635c9d2bb9f5d5c9123da0c8273441270eda4ed5e4d28117290fb55e6e030',
  },
  contests: [
    {
      id: 'nc-2026-state-representative-contests',
      office: { ...OTHER_PARTISAN.stateRepresentative, staggerGroup: null, termYears: 2 },
      year: 2026,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
    {
      id: 'nc-2026-sheriff-contests',
      office: { ...OTHER_PARTISAN.sheriff, staggerGroup: null, termYears: 4 },
      year: 2026,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
  ],
  cases: [
    ...casesFor(
      'nc-2026',
      { usSenate: US_SENATE, usHouse: US_HOUSE, ...OTHER_PARTISAN },
      { date: '2026-03-03', kind: 'primary', party: 'republican' },
      { track: 'party_primary', ...FILING },
      `${WINDOW} … ${WITHDRAWAL} … ${ELECTION_DATES}`,
    ),
    {
      id: 'nc-2026-board-of-education',
      office: SCHOOL_BOARD,
      contest: { date: '2026-03-03', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', ...FILING }],
      quote: `${WITHDRAWAL} … ${COUNTY_FILERS} … ${WINDOW} … ${BOARD_OF_EDUCATION}`,
    },
  ],
};
