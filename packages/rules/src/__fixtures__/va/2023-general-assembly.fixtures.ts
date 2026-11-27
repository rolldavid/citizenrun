import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'VA',
  source: {
    title: '2023 General Assembly Candidate Bulletin',
    url: 'https://www.elections.virginia.gov/media/candidatesandpacs/2023-candidate-bulletins/2023-11-07_Gen_Bulletin_HoD_SoV.pdf',
    retrievedOn: '2026-11-27',
    sha256: 'e541d64bb7faead6767c80c0e3d902b5659ecaee5fef45cc8b7eb2ad42894883',
  },
  contests: [],
  cases: [
    {
      id: 'va-2023-state-house-primary',
      office: {
        templateKey: 'state-house',
        officeTypeId: 'state-house',
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
        'Primary candidates File starting March 20th, 2023 at 12 pm. File ending April 6th, 2023 at 5 pm.',
    },
    {
      id: 'va-2023-state-house-independent',
      office: {
        templateKey: 'state-house',
        officeTypeId: 'state-house',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote:
        'Independent candidates File starting January 2nd, 2023. File ending June 20th, 2023 at 7 pm.',
    },
    {
      id: 'va-2023-state-senate-primary',
      office: {
        templateKey: 'state-senate',
        officeTypeId: 'state-senate',
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
        'Primary candidates File starting March 20th, 2023 at 12 pm. File ending April 6th, 2023 at 5 pm.',
    },
    {
      id: 'va-2023-state-senate-independent',
      office: {
        templateKey: 'state-senate',
        officeTypeId: 'state-senate',
        schedule: 'va_june_primary',
        trackSet: 'va_partisan',
      },
      contest: { date: '2023-11-07', kind: 'general', party: null },
      expect: [{ track: 'independent', closesOn: '2023-06-20', closesTime: '19:00' }],
      quote:
        'Independent candidates File starting January 2nd, 2023. File ending June 20th, 2023 at 7 pm.',
    },
  ],
};
