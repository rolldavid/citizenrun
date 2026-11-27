import type { RulesFixture } from '../../types.ts';
import { cityCouncil } from './offices.ts';

const MAY =
  'Saturday, May 6, 2028 – Uniform Election Date (Limited) … First Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)1 | Wednesday, January 19, 2028 … Last Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)2 | Friday, February 18, 2028 at 5:00 p.m.';
const NOVEMBER =
  'Tuesday, November 7, 2028 - Uniform Election Date … First Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)1 | Saturday, July 22, 2028 … Last Day to File for a Place on the General Election Ballot (Local Non-County Political Subdivisions Only)2 | Monday, August 21, 2028 at 5:00 p.m.';

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
      id: 'tx-2028-may-city-contests',
      office: cityCouncil('tx_uniform_may'),
      year: 2028,
      expect: [{ date: '2028-05-06', kind: 'general', party: null }],
      quote: 'Saturday, May 6, 2028 – Uniform Election Date (Limited)',
    },
    {
      id: 'tx-2028-november-city-contests',
      office: cityCouncil('tx_uniform_november'),
      year: 2028,
      expect: [{ date: '2028-11-07', kind: 'general', party: null }],
      quote: 'Tuesday, November 7, 2028 - Uniform Election Date',
    },
  ],
  cases: [
    {
      id: 'tx-2028-may-city',
      office: cityCouncil('tx_uniform_may'),
      contest: { date: '2028-05-06', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2028-01-19',
          closesOn: '2028-02-18',
          closesTime: '17:00',
        },
      ],
      quote: MAY,
    },
    {
      id: 'tx-2028-november-city',
      office: cityCouncil('tx_uniform_november'),
      contest: { date: '2028-11-07', kind: 'general', party: null },
      expect: [
        {
          track: 'nonpartisan',
          opensOn: '2028-07-22',
          closesOn: '2028-08-21',
          closesTime: '17:00',
        },
      ],
      quote: NOVEMBER,
    },
  ],
};
