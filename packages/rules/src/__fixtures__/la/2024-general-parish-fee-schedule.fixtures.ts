import type { RulesFixture } from '../../types.ts';

const QUALIFYING =
  '2024 Fall Election Fee Schedule Qualifying: July 17 – July 19, 2024 8:30 am – 4:30 pm Daily Primary: Tuesday, November 5, 2024';

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title: 'Calcasieu Clerk of Court: 2024 Fall Election Fee Schedule',
    // The clerk's link; it redirects to the site builder's file host (D-888), final URL
    // https://0fed7ada-ffd6-448a-9d77-f7f552b92923.filesusr.com/ugd/f77c15_f0f9fb4d779f4755a9a498e427534e9d.pdf
    url: 'https://www.calcasieuclerk.gov/_files/ugd/f77c15_f0f9fb4d779f4755a9a498e427534e9d.pdf',
    retrievedOn: '2026-11-27',
    sha256: '1c60efdffddc80c9c26a1dbfbd1a884422014f12f0e998a1b05e6a2dacdc1202',
  },
  contests: [],
  cases: [
    {
      id: 'la-2024-police-jury-qualifying',
      office: {
        templateKey: 'county-commission',
        officeTypeId: 'county-commission',
        schedule: 'la_congressional',
        trackSet: 'la_qualifying',
      },
      contest: { date: '2024-11-05', kind: 'primary', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2024-07-17',
          closesOn: '2024-07-19',
          closesTime: '16:30',
        },
      ],
      quote: QUALIFYING,
    },
    {
      id: 'la-2024-us-house-qualifying',
      office: {
        templateKey: 'us-house',
        officeTypeId: 'us-house',
        schedule: 'la_party_primary_congressional',
        trackSet: 'la_party_primary',
      },
      contest: { date: '2024-11-05', kind: 'primary', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2024-07-17',
          closesOn: '2024-07-19',
          closesTime: '16:30',
        },
      ],
      quote: QUALIFYING,
    },
  ],
};
