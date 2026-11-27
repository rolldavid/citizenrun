import type { RulesFixture } from '../../types.ts';

const QUALIFYING =
  '2023 GUBERNATORIAL ELECTIONS PRIMARY GENERAL QUALIFYING PERIOD October 14, 2023 November 18, 2023 August 8-10, 2023';

const BESE = {
  templateKey: 'state-education-board',
  officeTypeId: 'state-education-board',
  schedule: 'la_party_primary_gubernatorial',
  trackSet: 'la_party_primary',
} as const;

export const fixture: RulesFixture = {
  state: 'LA',
  source: {
    title: '10 - CALCASIEU PARISH (2023 Spring Elections; 2023 Gubernatorial Elections)',
    // The clerk's link; it redirects to the site builder's file host (D-888), final URL
    // https://0fed7ada-ffd6-448a-9d77-f7f552b92923.filesusr.com/ugd/f77c15_abd5831f28944a1b8c628b2c405a8b2e.pdf
    url: 'https://www.calcasieuclerk.gov/_files/ugd/f77c15_abd5831f28944a1b8c628b2c405a8b2e.pdf',
    retrievedOn: '2026-11-27',
    sha256: 'aedcdf049d13549b252f52c71204509ae7cccca3dcf200285280c4211a290adf',
  },
  contests: [
    {
      id: 'la-2023-bese-contests',
      office: BESE,
      year: 2023,
      expect: [
        { date: '2023-10-14', kind: 'primary', party: null },
        { date: '2023-11-18', kind: 'general', party: null },
      ],
      quote: QUALIFYING,
    },
  ],
  cases: [
    {
      id: 'la-2023-governor-qualifying',
      office: {
        templateKey: 'governor',
        officeTypeId: 'governor',
        schedule: 'la_gubernatorial',
        trackSet: 'la_qualifying',
      },
      contest: { date: '2023-10-14', kind: 'primary', party: null },
      expect: [{ track: 'nonpartisan', opensOn: '2023-08-08', closesOn: '2023-08-10' }],
      quote: QUALIFYING,
    },
    {
      id: 'la-2023-bese-qualifying',
      office: BESE,
      contest: { date: '2023-10-14', kind: 'primary', party: null },
      expect: [{ track: 'nonpartisan', opensOn: '2023-08-08', closesOn: '2023-08-10' }],
      quote: QUALIFYING,
    },
  ],
};
