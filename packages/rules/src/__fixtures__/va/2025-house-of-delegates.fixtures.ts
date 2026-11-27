import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'June and November 2025 Virginia House of Delegates Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2025-candidate-bulletins/2025-11-04_Gen_Bulletin_House_of_Del_rev_1-28-25.pdf',
    retrievedOn: '2026-11-27',
    sha256: '7798c2ce4f84ecc160709255d1d40b93fb3543205a523f61edc348a5ca21487f',
  },
  contests: [
    {
      id: 'va-2025-state-house-contests',
      office: {
        templateKey: 'state-house',
        officeTypeId: 'state-house',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2025,
      expect: [
        { date: '2025-06-17', kind: 'primary', party: 'democratic' },
        { date: '2025-06-17', kind: 'primary', party: 'republican' },
        { date: '2025-11-04', kind: 'general', party: null },
      ],
      quote:
        'Ballot Access Requirements for the June 17, 2025 Virginia House of Delegates Primary Elections and The November 4, 2025 Virginia House of Delegates General Elections',
    },
  ],
  cases: [
    {
      id: 'va-2025-state-house-primary',
      office: {
        templateKey: 'state-house',
        officeTypeId: 'state-house',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-06-17', kind: 'primary', party: 'democratic' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2025-03-17',
          closesOn: '2025-04-03',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 17, 2025, Noon (12:00 p.m.) Thursday, April 3, 2025, 5:00 p.m.',
    },
    {
      id: 'va-2025-state-house-independent',
      office: {
        templateKey: 'state-house',
        officeTypeId: 'state-house',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
  ],
};
