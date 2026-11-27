import type { RulesFixture } from '../../types.ts';
import { casesFor, COUNCIL_OF_STATE, OTHER_PARTISAN, SCHOOL_BOARD, US_SENATE } from './offices.ts';

const WINDOW =
  'Candidate filing for most contests in the 2020 elections begins at noon Monday, Dec. 2, and ends at noon Friday, Dec. 20.';
const WITHDRAWAL = 'Once filed, the deadline to withdraw a notice of candidacy is Dec. 17, 2019.';
const LOCAL =
  'Candidates for N.C. House, N.C. Senate and local offices file with their respective county board of elections.';
const PRIMARY_DAY = 'The 2020 primary election is March 3. The general election is Nov. 3.';

const FILING = {
  opensOn: '2019-12-02',
  closesOn: '2019-12-20',
  closesTime: '12:00',
  withdrawalDeadline: '2019-12-17',
} as const;

// Filing for U.S. House was postponed in this period by litigation, so it has no case here.
export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: '2020 Candidate Filing Period Begins Monday',
    url: 'https://www.ncsbe.gov/news/press-releases/2019/11/27/2020-candidate-filing-period-begins-monday',
    retrievedOn: '2026-11-27',
    sha256: 'ea2949e18d1b0e923a07690889e91fe7e8d19abb09bc8a9dfc070667b29d7c73',
  },
  contests: [],
  cases: [
    ...casesFor(
      'nc-2020',
      { usSenate: US_SENATE, ...COUNCIL_OF_STATE, ...OTHER_PARTISAN },
      { date: '2020-03-03', kind: 'primary', party: 'republican' },
      { track: 'party_primary', ...FILING },
      `${WINDOW} … ${WITHDRAWAL} … ${PRIMARY_DAY}`,
    ),
    {
      id: 'nc-2020-board-of-education',
      office: SCHOOL_BOARD,
      contest: { date: '2020-03-03', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', ...FILING }],
      quote: `${WINDOW} … ${WITHDRAWAL} … ${LOCAL} … ${PRIMARY_DAY}`,
    },
  ],
};
