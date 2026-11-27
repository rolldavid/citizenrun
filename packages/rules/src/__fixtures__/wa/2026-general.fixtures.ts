import type { RulesFixture } from '../../types.ts';
import {
  COUNTY_COMMISSIONER,
  PRECINCT_COMMITTEE_OFFICER,
  SHERIFF,
  STATE_HOUSE,
  STATE_SENATE,
  SUPERIOR_COURT,
  US_HOUSE,
} from './offices.ts';

const FILING_WEEK =
  'Monday, May 04, 2026 Official Candidate Filing Week opens … Friday, May 08, 2026 Final day for all candidates to file for office … Monday, May 11, 2026 Candidate withdrawal deadline';
const PRIMARY_DAY = 'Tuesday, August 04, 2026 PRIMARY';
const GENERAL_DAY = 'Tuesday, November 03, 2026 GENERAL ELECTION';
const ELECTION_DATES = `${PRIMARY_DAY} … ${GENERAL_DAY}`;
const GENERAL_FILING = `${FILING_WEEK} … ${GENERAL_DAY}`;

const PRIMARY = { date: '2026-08-04', kind: 'primary', party: null } as const;
const GENERAL = { date: '2026-11-03', kind: 'general', party: null } as const;
const WEEK = [
  {
    track: 'nonpartisan',
    opensOn: '2026-05-04',
    closesOn: '2026-05-08',
    withdrawalDeadline: '2026-05-11',
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
      id: 'wa-2026-state-house-contests',
      office: STATE_HOUSE,
      year: 2026,
      expect: [PRIMARY, GENERAL],
      quote: ELECTION_DATES,
    },
    {
      id: 'wa-2026-county-commissioner-contests',
      office: COUNTY_COMMISSIONER,
      year: 2026,
      expect: [PRIMARY, GENERAL],
      quote: ELECTION_DATES,
    },
    {
      id: 'wa-2026-precinct-committee-officer-contests',
      office: PRECINCT_COMMITTEE_OFFICER,
      year: 2026,
      expect: [PRIMARY],
      quote: PRIMARY_DAY,
    },
  ],
  cases: [
    {
      id: 'wa-2026-us-house',
      office: US_HOUSE,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2026-state-senate',
      office: STATE_SENATE,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2026-state-house',
      office: STATE_HOUSE,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2026-superior-court-judge',
      office: SUPERIOR_COURT,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2026-county-commissioner',
      office: COUNTY_COMMISSIONER,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2026-sheriff',
      office: SHERIFF,
      contest: GENERAL,
      expect: WEEK,
      quote: GENERAL_FILING,
    },
    {
      id: 'wa-2026-precinct-committee-officer',
      office: PRECINCT_COMMITTEE_OFFICER,
      contest: PRIMARY,
      expect: WEEK,
      quote: `${FILING_WEEK} … ${PRIMARY_DAY}`,
    },
  ],
};
