import type { RulesFixture } from '../../types.ts';
import { cityCouncil, schoolTrustee } from './offices.ts';

// The first day is Saturday 17 July 2027 and does not move for the weekend.
const FILING =
  'November 2, 2027 - Uniform Election Date … First Day to File for Place on General Election Ballot (for local political subdivisions ONLY)1 | Saturday, July 17, 2027 (“first day” does not move; office hours not required) … Last Day to File for Place on General Election Ballot (for local political subdivisions ONLY)2 | Monday, August 16, 2027 at 5:00 p.m.';

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
      id: 'tx-2027-november-city-contests',
      office: cityCouncil('tx_uniform_november'),
      year: 2027,
      expect: [{ date: '2027-11-02', kind: 'general', party: null }],
      quote: 'November 2, 2027 - Uniform Election Date',
    },
  ],
  cases: [
    {
      id: 'tx-2027-november-city',
      office: cityCouncil('tx_uniform_november'),
      contest: { date: '2027-11-02', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2027-07-17',
          closesOn: '2027-08-16',
          closesTime: '17:00',
        },
      ],
      quote: FILING,
    },
    {
      id: 'tx-2027-november-school',
      office: schoolTrustee('tx_uniform_november'),
      contest: { date: '2027-11-02', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2027-07-17',
          closesOn: '2027-08-16',
          closesTime: '17:00',
        },
      ],
      quote: FILING,
    },
  ],
};
