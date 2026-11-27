import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title:
      'Schedule of Reporting and Filing Dates for Candidates & PACs Supporting or Opposing Candidates: Primary Election October 9, 2027, General Election November 20, 2027',
    url: 'https://ethics.la.gov/Pub/CampFinan/Sched/20271009.pdf',
    retrievedOn: '2026-11-27',
    sha256: 'd47baf0ab59b98965b3a4515b1c21830e34b6ed341111167700ec96da57a1e10',
  },
  contests: [
    {
      id: 'la-2027-governor-contests',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
        schedule: 'la_gubernatorial',
        trackSet: 'la_qualifying',
      },
      year: 2027,
      expect: [
        { date: '2027-10-09', kind: 'primary', party: null },
        { date: '2027-11-20', kind: 'general', party: null },
      ],
      quote: 'PRIMARY ELECTION – October 9, 2027 GENERAL ELECTION – November 20, 2027',
    },
  ],
  cases: [],
};
