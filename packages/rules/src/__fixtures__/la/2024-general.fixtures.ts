import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title:
      'Schedule of Reporting and Filing Dates for Candidates & PACs Supporting or Opposing Candidates: Primary Election November 5, 2024, General Election December 7, 2024',
    url: 'https://ethics.la.gov/Pub/CampFinan/Sched/20241105.pdf',
    retrievedOn: '2026-11-27',
    sha256: '81e89f6d15af4b5b355302a22aae3039114978913e9405ab0732eb01964eb2f3',
  },
  contests: [
    {
      id: 'la-2024-us-house-contests',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        schedule: 'la_party_primary_congressional',
        trackSet: 'la_party_primary',
      },
      year: 2024,
      expect: [
        { date: '2024-11-05', kind: 'primary', party: null },
        { date: '2024-12-07', kind: 'general', party: null },
      ],
      quote: 'PRIMARY ELECTION – November 5, 2024 GENERAL ELECTION – December 7, 2024',
    },
    {
      id: 'la-2024-district-judge-contests',
      office: {
        templateKey: 'district-judge',
        officeTypeId: 'trial-judge',
        schedule: 'la_congressional',
        trackSet: 'la_qualifying',
      },
      year: 2024,
      expect: [
        { date: '2024-11-05', kind: 'primary', party: null },
        { date: '2024-12-07', kind: 'general', party: null },
      ],
      quote: 'PRIMARY ELECTION – November 5, 2024 GENERAL ELECTION – December 7, 2024',
    },
  ],
  cases: [],
};
