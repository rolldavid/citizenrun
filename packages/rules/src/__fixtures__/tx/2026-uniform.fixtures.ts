import type { RulesFixture } from '../../types.ts';
import { cityCouncil, schoolTrustee } from './offices.ts';

const MAY =
  'Saturday, May 2, 2026 – Uniform Election Date (Limited) … First Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)1 | Wednesday, January 14, 2026 … Last Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)2 | Friday, February 13, 2026 at 5:00 p.m.';
const NOVEMBER =
  'Tuesday, November 3, 2026 - Uniform Election Date … First Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)1 | Saturday, July 18, 2026 … Last Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)2 | Monday, August 17, 2026 at 5:00 p.m.';

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
      id: 'tx-2026-may-city-contests',
      office: cityCouncil('tx_uniform_may'),
      year: 2026,
      expect: [{ date: '2026-05-02', kind: 'general', party: null }],
      quote: 'Saturday, May 2, 2026 – Uniform Election Date (Limited)',
    },
    {
      id: 'tx-2026-november-city-contests',
      office: cityCouncil('tx_uniform_november'),
      year: 2026,
      expect: [{ date: '2026-11-03', kind: 'general', party: null }],
      quote: 'Tuesday, November 3, 2026 - Uniform Election Date',
    },
  ],
  cases: [
    {
      id: 'tx-2026-may-city',
      office: cityCouncil('tx_uniform_may'),
      contest: { date: '2026-05-02', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2026-01-14',
          closesOn: '2026-02-13',
          closesTime: '17:00',
        },
      ],
      quote: MAY,
    },
    {
      id: 'tx-2026-may-school',
      office: schoolTrustee('tx_uniform_may'),
      contest: { date: '2026-05-02', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2026-01-14',
          closesOn: '2026-02-13',
          closesTime: '17:00',
        },
      ],
      quote: MAY,
    },
    {
      id: 'tx-2026-november-city',
      office: cityCouncil('tx_uniform_november'),
      contest: { date: '2026-11-03', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2026-07-18',
          closesOn: '2026-08-17',
          closesTime: '17:00',
        },
      ],
      quote: NOVEMBER,
    },
  ],
};
