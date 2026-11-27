import type { RulesFixture } from '../../types.ts';
import { cityCouncil, schoolTrustee } from './offices.ts';

const FILING =
  'May 1, 2027 - Uniform Election Date … First Day to File for Place on General Election Ballot (for local political subdivisions ONLY)1 | Wednesday, January 13, 2027 … Last Day to File for Place on General Election Ballot (for local political subdivisions ONLY)2 | Friday, February 12, 2027 at 5:00 p.m.';

export const fixture: RulesFixture = {
  state: 'TX',
  source: {
    title: 'Important Election Dates',
    url: 'https://www.sos.texas.gov/elections/voter/important-election-dates.shtml',
    retrievedOn: '2026-11-27',
    sha256: '388a64355b101abc1d02b0add0a9eee0b4806e93dc424b746176b1e0436aa8f4',
  },
  contests: [
    {
      id: 'tx-2027-may-city-contests',
      office: cityCouncil('tx_uniform_may'),
      year: 2027,
      expect: [{ date: '2027-05-01', kind: 'general', party: null }],
      quote: 'May 1, 2027 - Uniform Election Date',
    },
  ],
  cases: [
    {
      id: 'tx-2027-may-city',
      office: cityCouncil('tx_uniform_may'),
      contest: { date: '2027-05-01', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2027-01-13',
          closesOn: '2027-02-12',
          closesTime: '17:00',
        },
      ],
      quote: FILING,
    },
    {
      id: 'tx-2027-may-school',
      office: schoolTrustee('tx_uniform_may'),
      contest: { date: '2027-05-01', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2027-01-13',
          closesOn: '2027-02-12',
          closesTime: '17:00',
        },
      ],
      quote: FILING,
    },
  ],
};
