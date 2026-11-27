import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'June and November 2024 Local Offices Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2024-candidate-bulletins/2024-11-05-Gen-Bulletin-Local-Offices-(3-8-24).pdf',
    retrievedOn: '2026-11-27',
    sha256: '26422c34641621516f66faed821547664d84229edf7fd3c7cc87b5e2ff249e2c',
  },
  contests: [],
  cases: [
    {
      id: 'va-2024-city-council-primary',
      office: {
        templateKey: 'city-council',
        officeTypeId: 'city-council',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2024-06-18', kind: 'primary', party: 'democratic' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2024-03-18',
          closesOn: '2024-04-04',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 18, 2024 at 12:00 pm Thursday, April 4, 2024 at 5:00 pm',
    },
    {
      id: 'va-2024-city-council-independent',
      office: {
        templateKey: 'city-council',
        officeTypeId: 'city-council',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
        partisan: true,
      },
      contest: { date: '2024-11-05', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2024-06-18', closesTime: '19:00' }],
      quote: 'Independent candidates: Tuesday, January 2, 2024. Tuesday, June 18, 2024 at 7:00 pm',
    },
    {
      id: 'va-2024-mayor-primary',
      office: {
        templateKey: 'mayor',
        officeTypeId: 'mayor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2024-06-18', kind: 'primary', party: 'republican' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2024-03-18',
          closesOn: '2024-04-04',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 18, 2024 at 12:00 pm Thursday, April 4, 2024 at 5:00 pm',
    },
    {
      id: 'va-2024-mayor-independent',
      office: {
        templateKey: 'mayor',
        officeTypeId: 'mayor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
        partisan: true,
      },
      contest: { date: '2024-11-05', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2024-06-18', closesTime: '19:00' }],
      quote: 'Independent candidates: Tuesday, January 2, 2024. Tuesday, June 18, 2024 at 7:00 pm',
    },
    {
      id: 'va-2024-school-board-nonpartisan',
      office: {
        templateKey: 'school-board',
        officeTypeId: 'school-board',
        schedule: 'va_november_general',
        trackSet: 'va_nonpartisan',
      },
      contest: { date: '2024-11-05', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', closesOn: '2024-06-18', closesTime: '19:00' }],
      quote: 'Independent candidates: Tuesday, January 2, 2024. Tuesday, June 18, 2024 at 7:00 pm',
    },
  ],
};
