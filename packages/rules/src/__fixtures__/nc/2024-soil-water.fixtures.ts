import type { RulesFixture } from '../../types.ts';
import { SOIL_WATER_SUPERVISOR } from './offices.ts';

export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'Candidate Filing Period: Soil & Water Districts',
    url: 'https://www.ncsbe.gov/news/events/candidate-filing-period-soil-water-districts-2024-general-election',
    retrievedOn: '2026-11-27',
    sha256: 'b1f5aa0b73447913820a03e38d6270a7e773c8bd14656d5ebffb3805bf291109',
  },
  contests: [],
  cases: [
    {
      id: 'nc-2024-soil-water-supervisor',
      office: SOIL_WATER_SUPERVISOR,
      contest: { date: '2024-11-05', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2024-06-10',
          closesOn: '2024-07-05',
          closesTime: '12:00',
        },
      ],
      quote:
        'The candidate filing period for soil and water conservation district supervisors begins at noon on Monday, June 10, 2024, and ends at noon on Friday, July 5, 2024.',
    },
  ],
};
