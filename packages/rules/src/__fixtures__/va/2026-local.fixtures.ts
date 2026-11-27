import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'August and November 2026 Local Office Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2026-candidate-bulletins/2026-11-03_Local_Gen_Bulletin_(2-23-26).pdf',
    retrievedOn: '2026-11-27',
    sha256: 'ec1541b4a2bc36fe633a85aaeec27bcd61401a62f6dfb757755b332eaf1384bb',
  },
  contests: [],
  cases: [
    {
      id: 'va-2026-city-council-primary',
      office: {
        templateKey: 'city-council',
        officeTypeId: 'city-council',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2026-08-04', kind: 'primary', party: 'democratic' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2026-03-16',
          closesOn: '2026-04-02',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 16, 2026, Noon (12:00 pm) Thursday, April 2, 2026, 5:00 pm',
    },
    {
      id: 'va-2026-city-council-independent',
      office: {
        templateKey: 'city-council',
        officeTypeId: 'city-council',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
        partisan: true,
      },
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2026-06-16', closesTime: '19:00' }],
      quote: 'General Tuesday, November 3, 2026 Tuesday, June 16, 2026, 7:00 pm',
    },
    {
      id: 'va-2026-mayor-primary',
      office: {
        templateKey: 'mayor',
        officeTypeId: 'mayor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2026-08-04', kind: 'primary', party: 'republican' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2026-03-16',
          closesOn: '2026-04-02',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 16, 2026, Noon (12:00 pm) Thursday, April 2, 2026, 5:00 pm',
    },
    {
      id: 'va-2026-mayor-independent',
      office: {
        templateKey: 'mayor',
        officeTypeId: 'mayor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
        partisan: true,
      },
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2026-06-16', closesTime: '19:00' }],
      quote: 'General Tuesday, November 3, 2026 Tuesday, June 16, 2026, 7:00 pm',
    },
    {
      id: 'va-2026-school-board-nonpartisan',
      office: {
        templateKey: 'school-board',
        officeTypeId: 'school-board',
        schedule: 'va_november_general',
        trackSet: 'va_nonpartisan',
      },
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', closesOn: '2026-06-16', closesTime: '19:00' }],
      quote: 'General Tuesday, November 3, 2026 Tuesday, June 16, 2026, 7:00 pm',
    },
  ],
};
