import type { RulesFixture } from '../../types.ts';

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title: 'Act No. 7, 2026 Regular Session (House Bill No. 842, Enrolled)',
    url: 'https://legis.la.gov/legis/ViewDocument.aspx?d=1473830',
    retrievedOn: '2026-11-27',
    sha256: '1fe3af276beaf75777289afa45be784674793dced746d6cfa0742a2056571fa5',
  },
  contests: [
    {
      id: 'la-2026-us-house-contests',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        schedule: 'la_party_primary_congressional',
        trackSet: 'la_party_primary',
      },
      year: 2026,
      expect: [
        { date: '2026-11-03', kind: 'primary', party: null },
        { date: '2026-12-12', kind: 'general', party: null },
      ],
      quote:
        '(B) Candidates for representative in the United States Congress shall be elected at 10 the open primary election to be held on November 3, 2026, and the open general election to 11 be held on December 12, 2026.',
    },
  ],
  cases: [
    {
      id: 'la-2026-fall-us-house-qualifying',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        schedule: 'la_party_primary_congressional',
        trackSet: 'la_party_primary',
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
        'the qualifying period for all 13 candidates in the 2026 fall primary election, including candidates for representative in the 14 United States Congress, shall begin on August 5, 2026. The qualifying period for such 15 candidates shall close at 4:30 p.m. on August 7, 2026.',
    },
  ],
};
