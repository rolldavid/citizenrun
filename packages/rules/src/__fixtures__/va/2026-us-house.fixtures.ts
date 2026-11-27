import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'August and November 2026 US House of Representatives Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2026-candidate-bulletins/2026-11-03_US_House_Gen_Bulletin_(2-23-26).pdf',
    retrievedOn: '2026-11-27',
    sha256: '7b88edd2659c37505f7ac7e89f12ac1ed9dce144efac9f569ce9a29d9dab973b',
  },
  contests: [
    {
      id: 'va-2026-us-house-contests',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
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
        'Ballot Access Requirements for the August 4, 2026, US House of Representatives Primary Elections and November 3, 2026, US House of Representatives General Elections',
    },
  ],
  cases: [
    {
      id: 'va-2026-us-house-primary',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2026-08-04', kind: 'primary', party: 'democratic' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2026-05-01',
          closesOn: '2026-05-26',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Friday, May 1, 2026, Noon (12:00 pm) Tuesday, May 26, 2026, 5:00 pm',
    },
    {
      id: 'va-2026-us-house-independent',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2026-08-04', closesTime: '19:00' }],
      quote: 'General Tuesday, November 3, 2026 Tuesday, August 4, 2026, 7:00 pm',
    },
  ],
};
