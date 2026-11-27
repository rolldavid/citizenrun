import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title:
      'Schedule of Reporting and Filing Dates for Candidates & PACs Supporting or Opposing Candidates: Primary Election October 14, 2023, General Election November 18, 2023',
    url: 'https://ethics.la.gov/Pub/CampFinan/Sched/20231014.pdf',
    retrievedOn: '2026-11-27',
    sha256: 'aaa700c595ae18f02bdc1731237bab44fa1f89b3190cd6c54c7c0dba93fcd9c9',
  },
  contests: [
    {
      id: 'la-2023-governor-contests',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
        schedule: 'la_gubernatorial',
        trackSet: 'la_qualifying',
      },
      year: 2023,
      expect: [
        { date: '2023-10-14', kind: 'primary', party: null },
        { date: '2023-11-18', kind: 'general', party: null },
      ],
      quote: 'PRIMARY ELECTION – October 14, 2023 GENERAL ELECTION – November 18, 2023',
    },
  ],
  cases: [],
};
