import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: 'June and November 2025 Local Offices Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2025-candidate-bulletins/2025-11-04_Gen_Bulletin_Local_rev_12-5-2024.pdf',
    retrievedOn: '2026-11-27',
    sha256: '8d5d91e6edc8561159cf200e00b5e761e711890436cda298cb13bf733a70561a',
  },
  contests: [],
  cases: [
    {
      id: 'va-2025-county-commission-primary',
      office: {
        templateKey: 'county-commission',
        officeTypeId: 'county-commission',
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
      id: 'va-2025-county-commission-independent',
      office: {
        templateKey: 'county-commission',
        officeTypeId: 'county-commission',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
    {
      id: 'va-2025-sheriff-primary',
      office: {
        templateKey: 'sheriff',
        officeTypeId: 'sheriff',
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
      id: 'va-2025-sheriff-independent',
      office: {
        templateKey: 'sheriff',
        officeTypeId: 'sheriff',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
    {
      id: 'va-2025-district-attorney-primary',
      office: {
        templateKey: 'district-attorney',
        officeTypeId: 'district-attorney',
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
      id: 'va-2025-district-attorney-independent',
      office: {
        templateKey: 'district-attorney',
        officeTypeId: 'district-attorney',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
    {
      id: 'va-2025-county-treasurer-primary',
      office: {
        templateKey: 'county-treasurer',
        officeTypeId: 'county-treasurer',
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
      id: 'va-2025-county-treasurer-independent',
      office: {
        templateKey: 'county-treasurer',
        officeTypeId: 'county-treasurer',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
    {
      id: 'va-2025-county-assessor-primary',
      office: {
        templateKey: 'county-assessor',
        officeTypeId: 'county-assessor',
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
      id: 'va-2025-county-assessor-independent',
      office: {
        templateKey: 'county-assessor',
        officeTypeId: 'county-assessor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
    {
      id: 'va-2025-school-board-nonpartisan',
      office: {
        templateKey: 'school-board',
        officeTypeId: 'school-board',
        schedule: 'va_november_general',
        trackSet: 'va_nonpartisan',
      },
      contest: { date: '2025-11-04', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', closesOn: '2025-06-17', closesTime: '19:00' }],
      quote: 'General Tuesday, November 4, 2025 Tuesday, June 17, 2025, 7:00 p.m.',
    },
  ],
};
