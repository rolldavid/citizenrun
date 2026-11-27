import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: '2023 Local Offices Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2023-candidate-bulletins/2023-11-07_Gen_Bulletin_Local_Offices.pdf',
    retrievedOn: '2026-11-27',
    sha256: '1e1270a188d72faf06301aff4fd1eacece5ae03ba53de9a890e0c0c942db7b70',
  },
  contests: [],
  cases: [
    {
      id: 'va-2023-county-commission-primary',
      office: {
        templateKey: 'county-commission',
        officeTypeId: 'county-commission',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-06-20', kind: 'primary', party: 'democratic' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-03-20',
          closesOn: '2023-04-06',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 20, 2023 at 12:00 p.m. Thursday, April 6, 2023 at 5:00 p.m.',
    },
    {
      id: 'va-2023-county-commission-independent',
      office: {
        templateKey: 'county-commission',
        officeTypeId: 'county-commission',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
    {
      id: 'va-2023-sheriff-primary',
      office: {
        templateKey: 'sheriff',
        officeTypeId: 'sheriff',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-06-20', kind: 'primary', party: 'republican' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-03-20',
          closesOn: '2023-04-06',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 20, 2023 at 12:00 p.m. Thursday, April 6, 2023 at 5:00 p.m.',
    },
    {
      id: 'va-2023-sheriff-independent',
      office: {
        templateKey: 'sheriff',
        officeTypeId: 'sheriff',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
    {
      id: 'va-2023-district-attorney-primary',
      office: {
        templateKey: 'district-attorney',
        officeTypeId: 'district-attorney',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-06-20', kind: 'primary', party: 'democratic' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-03-20',
          closesOn: '2023-04-06',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 20, 2023 at 12:00 p.m. Thursday, April 6, 2023 at 5:00 p.m.',
    },
    {
      id: 'va-2023-district-attorney-independent',
      office: {
        templateKey: 'district-attorney',
        officeTypeId: 'district-attorney',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
    {
      id: 'va-2023-county-treasurer-primary',
      office: {
        templateKey: 'county-treasurer',
        officeTypeId: 'county-treasurer',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-06-20', kind: 'primary', party: 'republican' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-03-20',
          closesOn: '2023-04-06',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 20, 2023 at 12:00 p.m. Thursday, April 6, 2023 at 5:00 p.m.',
    },
    {
      id: 'va-2023-county-treasurer-independent',
      office: {
        templateKey: 'county-treasurer',
        officeTypeId: 'county-treasurer',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
    {
      id: 'va-2023-county-assessor-primary',
      office: {
        templateKey: 'county-assessor',
        officeTypeId: 'county-assessor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-06-20', kind: 'primary', party: 'democratic' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-03-20',
          closesOn: '2023-04-06',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 20, 2023 at 12:00 p.m. Thursday, April 6, 2023 at 5:00 p.m.',
    },
    {
      id: 'va-2023-county-assessor-independent',
      office: {
        templateKey: 'county-assessor',
        officeTypeId: 'county-assessor',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
    {
      id: 'va-2023-county-row-other-primary',
      office: {
        templateKey: 'county-row-other',
        officeTypeId: 'county-row-other',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-06-20', kind: 'primary', party: 'republican' },
      expect: [
        {
          track: 'party_primary',
          opensOn: '2023-03-20',
          closesOn: '2023-04-06',
          closesTime: '17:00',
        },
      ],
      quote:
        'Primary candidates: Monday, March 20, 2023 at 12:00 p.m. Thursday, April 6, 2023 at 5:00 p.m.',
    },
    {
      id: 'va-2023-county-row-other-independent',
      office: {
        templateKey: 'county-row-other',
        officeTypeId: 'county-row-other',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
    {
      id: 'va-2023-school-board-nonpartisan',
      office: {
        templateKey: 'school-board',
        officeTypeId: 'school-board',
        schedule: 'va_november_general',
        trackSet: 'va_nonpartisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
    {
      id: 'va-2023-soil-water-conservation-board-nonpartisan',
      office: {
        templateKey: 'soil-water-conservation-board',
        officeTypeId: 'soil-water-conservation-board',
        schedule: 'va_november_general',
        trackSet: 'va_nonpartisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'nonpartisan', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote: 'General Tuesday, November 7, 2023 Tuesday, June 20, 2023 at 7:00 p.m.',
    },
  ],
};
