import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'June and November 2024 United States Senate Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2024-candidate-bulletins/2024-11-05-Gen-Bulletin-US-Senate-(11-6-23).pdf',
    retrievedOn: '2026-11-27',
    sha256: '83b2bc4db1e0359ce63f028ed707279c9ecd2802a30b72b108f2bb830484c529',
  },
  contests: [],
  cases: [
    {
      id: 'va-2024-us-senate-primary',
      office: {
        templateKey: 'us-senate',
        officeTypeId: 'us-senate',
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
        'Primary candidates: Monday, March 18, 2024 at 12:00 p.m. Thursday, April 4, 2024 at 5:00 p.m.',
    },
    {
      id: 'va-2024-us-senate-independent',
      office: {
        templateKey: 'us-senate',
        officeTypeId: 'us-senate',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2024-11-05', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2024-06-18', closesTime: '19:00' }],
      quote:
        'Independent candidates: Tuesday, January 2, 2024. Tuesday, June 18, 2024 at 7:00 p.m.',
    },
  ],
};
