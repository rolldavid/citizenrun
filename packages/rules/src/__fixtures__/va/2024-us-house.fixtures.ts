import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'June and November 2024 United States House of Representatives Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2024-candidate-bulletins/2024-11-05-Gen-Bulletin-US-House-of-Reps-(11-6-23).pdf',
    retrievedOn: '2026-11-27',
    sha256: '450eb60c3856080807f2a86de1b95b1fc70f22555704b6c563397bf9c1f0237e',
  },
  contests: [
    {
      id: 'va-2024-us-house-contests',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        partisan: true,
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      year: 2024,
      expect: [
        { date: '2024-06-18', kind: 'primary', party: 'democratic' },
        { date: '2024-06-18', kind: 'primary', party: 'republican' },
        { date: '2024-11-05', kind: 'general', party: null },
      ],
      quote:
        'Ballot Access Requirements for the June 18, 2024 Primary and the November 5, 2024 General Elections',
    },
  ],
  cases: [
    {
      id: 'va-2024-us-house-primary',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
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
      id: 'va-2024-us-house-independent',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2024-11-05', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2024-06-18', closesTime: '19:00' }],
      quote: 'General Tuesday, November 5, 2024 Tuesday, June 18, 2024 at 7:00 p.m.',
    },
  ],
};
