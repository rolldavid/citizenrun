import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title: 'Elec3 - Qualfying / Candidate Info | Calcasieu Clerk',
    url: 'https://calcasieuclerk.gov/qualifying-and-candidate-info',
    retrievedOn: '2026-11-27',
    sha256: 'e7cbb8149eb3b88c0069061ced829df69eac890224ea3c89fc93ac9149541013',
  },
  contests: [],
  cases: [
    {
      id: 'la-2026-fall-school-board-qualifying',
      office: {
        templateKey: 'school-board',
        officeTypeId: 'school-board',
        schedule: 'la_congressional',
        trackSet: 'la_qualifying',
      },
      contest: { date: '2026-11-03', kind: 'primary', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2026-08-05',
          closesOn: '2026-08-07',
          closesTime: '16:30',
        },
      ],
      quote:
        '2026 Fall Election - Tues Nov 3, 2026 Qualifying Dates: UPDATED: Wed Aug 5, 2026 through Fri Aug 7, 2026 Qualifying Times: 8:30 am – 4:30 pm daily',
    },
  ],
};
