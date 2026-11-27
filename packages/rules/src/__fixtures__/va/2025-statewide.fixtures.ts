import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'June and November 2025 Statewide Offices Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2025-candidate-bulletins/2025-11-04_Gen_Bulletin_Gov_LtGov_AttGen_rev_1-28-25.pdf',
    retrievedOn: '2026-11-27',
    sha256: '787dd7fa5171046fe4511f21e7e39c51f2da7ef027f158eda7b44ba264237a1b',
  },
  contests: [
    {
      id: 'va-2025-governor-contests',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
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
        'Ballot Access Requirements for the June 17, 2025 Governor, Lieutenant Governor, and Attorney General Primary Elections and The November 4, 2025 Governor, Lieutenant Governor, and Attorney General General Elections',
    },
  ],
  cases: [
    {
      id: 'va-2025-governor-primary',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
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
      id: 'va-2025-governor-independent',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
        partisan: true,
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
    {
      id: 'va-2025-statewide-executive-other-primary',
      office: {
        templateKey: 'statewide-executive-other',
        officeTypeId: 'statewide-executive-other',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-06-17', kind: 'primary', party: 'republican' },
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
      id: 'va-2025-statewide-executive-other-independent',
      office: {
        templateKey: 'statewide-executive-other',
        officeTypeId: 'statewide-executive-other',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
        partisan: true,
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
    {
      id: 'va-2025-attorney-general-primary',
      office: {
        templateKey: 'attorney-general',
        officeTypeId: 'attorney-general',
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
      id: 'va-2025-attorney-general-independent',
      office: {
        templateKey: 'attorney-general',
        officeTypeId: 'attorney-general',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
        partisan: true,
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
  ],
};
