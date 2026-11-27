import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title:
      'Schedule of Reporting and Filing Dates for Candidates & Committees Supporting or Opposing Candidates: Primary Election November 3, 2026, General Election December 12, 2026',
    url: 'https://ethics.la.gov/Pub/CampFinan/Sched/20261103.pdf',
    retrievedOn: '2026-11-27',
    sha256: 'c10b050eca464d543b3d42192f30d61244ecb35862033f06d4252285db51232c',
  },
  contests: [
    {
      id: 'la-2026-district-judge-contests',
      office: {
        templateKey: 'district-judge',
        officeTypeId: 'trial-judge',
        schedule: 'la_congressional',
        trackSet: 'la_qualifying',
      },
      year: 2026,
      expect: [
        { date: '2026-11-03', kind: 'primary', party: null },
        { date: '2026-12-12', kind: 'general', party: null },
      ],
      quote: 'PRIMARY ELECTION – November 3, 2026 GENERAL ELECTION – December 12, 2026',
    },
  ],
  cases: [],
};
