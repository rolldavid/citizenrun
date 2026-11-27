import type { RulesFixture } from '../../types.ts';
import { CITY_COUNCIL } from './offices.ts';

// Friday 4 July 2025 was Independence Day, so filing opened on Monday 7 July (G.S. 103-5(a)).
export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'Candidate Filing Period',
    url: 'https://www.ncsbe.gov/news/events/candidate-filing-period-2025-municipal-elections',
    retrievedOn: '2026-11-27',
    sha256: '98dee36190d78476c1bc4618b8cdff0d1c779bc0266f47bb38e34d2b09a114c2',
  },
  contests: [],
  cases: [
    {
      id: 'nc-2025-city-council',
      office: CITY_COUNCIL,
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2025-07-07',
          closesOn: '2025-07-18',
          closesTime: '12:00',
          withdrawalDeadline: '2025-07-15',
        },
      ],
      quote:
        'The candidate filing period for the 2025 partisan and nonpartisan municipal elections begins at the opening of business on Monday, July 7, 2025, for county boards of elections, and ends at noon on Friday, July 18, 2025, unless otherwise stated in a municipal charter or session law. … The deadline to withdraw a notice of candidacy and receive a refund is 5 p.m. Tuesday, July 15, 2025.',
    },
  ],
};
