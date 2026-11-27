import type { RulesFixture } from '../../types.ts';
import { SOIL_WATER_SUPERVISOR } from './offices.ts';

export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'Candidate Filing Period Starts: Soil and Water Districts',
    url: 'https://www.ncsbe.gov/news/events/candidate-filing-period-starts-soil-and-water-districts-2022-general-election',
    retrievedOn: '2026-11-27',
    sha256: '936e19a623ffcd0210700de4f75be57d13659674e820b294031e0d3dc1dbbec1',
  },
  contests: [],
  cases: [
    {
      id: 'nc-2022-soil-water-supervisor',
      office: SOIL_WATER_SUPERVISOR,
      contest: { date: '2022-11-08', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2022-06-13',
          closesOn: '2022-07-01',
          closesTime: '12:00',
        },
      ],
      quote:
        'The candidate filing period for soil and water conservation district supervisors begins at noon on Monday, June 13, 2022, and ends at noon on Friday, July 1.',
    },
  ],
};
