import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'August and November 2026 US Senate Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2026-candidate-bulletins/2026-11-03_US_Sen_Gen_Bulletin_(2-23-26).pdf',
    retrievedOn: '2026-11-27',
    sha256: '25eddadcec6a69ec74c070a7c0765ca0d93664bcb0e085e4c1c0b84bb23323e7',
  },
  contests: [
    {
      id: 'va-2026-us-senate-contests',
      office: {
        templateKey: 'us-senate',
        officeTypeId: 'us-senate',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2026,
      expect: [
        { date: '2026-08-04', kind: 'primary', party: 'democratic' },
        { date: '2026-08-04', kind: 'primary', party: 'republican' },
        { date: '2026-11-03', kind: 'general', party: null },
      ],
      quote:
        'Ballot Access Requirements for the August 4, 2026, US Senate Primary Elections and November 3, 2026, US Senate General Elections',
    },
  ],
  cases: [
    {
      id: 'va-2026-us-senate-primary',
      office: {
        templateKey: 'us-senate',
        officeTypeId: 'us-senate',
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
      id: 'va-2026-us-senate-independent',
      office: {
        templateKey: 'us-senate',
        officeTypeId: 'us-senate',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2026-06-16', closesTime: '19:00' }],
      quote: 'General Tuesday, November 3, 2026 Tuesday, June 16, 2026, 7:00 pm',
    },
  ],
};
