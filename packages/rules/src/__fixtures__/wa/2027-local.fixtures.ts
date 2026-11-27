import type { RulesFixture } from '../../types.ts';
import { CITY_COUNCIL, FIRE_COMMISSIONER, MAYOR, SCHOOL_DIRECTOR } from './offices.ts';

const FILING_WEEK =
  'Monday, May 03, 2027 Official Candidate Filing Week opens … Friday, May 07, 2027 Final day for all candidates to file for office … Monday, May 10, 2027 Candidate withdrawal deadline';
const PRIMARY_DAY = 'Tuesday, August 03, 2027 PRIMARY';
const GENERAL_DAY = 'Tuesday, November 02, 2027 GENERAL ELECTION';
const ELECTION_DATES = `${PRIMARY_DAY} … ${GENERAL_DAY}`;
const GENERAL_FILING = `${FILING_WEEK} … ${GENERAL_DAY}`;

const CONTESTS = [
  { date: '2027-08-03', kind: 'primary', party: null },
  { date: '2027-11-02', kind: 'general', party: null },
] as const;
const GENERAL = { date: '2027-11-02', kind: 'general', party: null } as const;
const WEEK = [
  {
    track: 'nonpartisan',
    opensOn: '2027-05-03',
    closesOn: '2027-05-07',
    withdrawalDeadline: '2027-05-10',
  },
] as const;

export const fixture: RulesFixture = {
  state: 'WA',
  source: {
    title: 'Elections Calendar',
    url: 'https://www.sos.wa.gov/elections/calendar',
    retrievedOn: '2026-11-27',
    sha256: '479050a6bb9ffa27e9083259f0922f00ebd74b4a39ea9eb80847b5d77812ee9a',
  },
  contests: [
    {
      id: 'wa-2027-city-council-contests',
      office: CITY_COUNCIL,
      year: 2027,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
    {
      id: 'wa-2027-fire-commissioner-contests',
      office: FIRE_COMMISSIONER,
      year: 2027,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
  ],
  cases: [
    {
      id: 'wa-2027-city-council',
      office: CITY_COUNCIL,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2027-mayor',
      office: MAYOR,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2027-school-director',
      office: SCHOOL_DIRECTOR,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
  ],
};
