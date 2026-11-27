import type { RulesFixture } from '../../types.ts';
import { CITY_COUNCIL, SOIL_WATER_SUPERVISOR } from './offices.ts';

// Friday 3 July 2026 was the State's observed Independence Day, so municipal filing opened and soil
// and water filing closed on Monday 6 July (G.S. 103-5(a)); the Board states no noon for that day.
export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'Running for Office',
    url: 'https://www.ncsbe.gov/candidates/running-office',
    retrievedOn: '2026-11-27',
    sha256: 'b817656d7698c6ece6214a342e6275758160be4975258912d62754e79e1ca846',
  },
  contests: [],
  cases: [
    {
      id: 'nc-2026-city-council',
      office: CITY_COUNCIL,
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2026-07-06',
          closesOn: '2026-07-17',
          closesTime: '12:00',
          withdrawalDeadline: '2026-07-14',
        },
      ],
      quote:
        'Candidate filing for municipalities with even-numbered year elections begins at county offices’ regular business hours for the county board of elections office on Monday, July 6, 2026, and ends at noon on Friday, July 17, 2026. … The deadline for a candidate to withdraw the notice of candidacy and receive a refund is 5 p.m. on Tuesday, July 14, 2026.',
    },
    {
      id: 'nc-2026-soil-water-supervisor',
      office: SOIL_WATER_SUPERVISOR,
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2026-06-08',
          closesOn: '2026-07-06',
          closesTime: null,
        },
      ],
      quote:
        'The candidate filing period for soil and water conservation district supervisors begins at noon on Monday, June 8, 2026, and ends by the close of regular business hours for county boards of elections on Monday, July 6, 2026.',
    },
  ],
};
