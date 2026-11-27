import type { RulesFixture } from '../../types.ts';
import { CITY_COUNCIL } from './offices.ts';

export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: '2023 Municipal Elections: A Candidate’s Guide to Elections in North Carolina',
    url: 'https://dl.ncsbe.gov/Candidate%20Filing/2023%20Municipal%20Candidate%20Guide.pdf',
    retrievedOn: '2026-11-27',
    sha256: '1a0f32ea07444d88617909ff13705d96d8ee5b20627e43788bcd7e87fe253334',
  },
  contests: [],
  cases: [
    {
      id: 'nc-2023-city-council',
      office: CITY_COUNCIL,
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2023-07-07',
          closesOn: '2023-07-21',
          closesTime: '12:00',
          withdrawalDeadline: '2023-07-18',
        },
      ],
      quote:
        'Candidate filing for municipalities with odd-numbered year elections begins at 12 noon on Friday, July 7, 2023, until 12 noon on Friday, July 21, 2023. … The deadline for a candidate to withdraw the notice of candidacy is by 5pm on Tuesday, July 18, 2023.',
    },
  ],
};
