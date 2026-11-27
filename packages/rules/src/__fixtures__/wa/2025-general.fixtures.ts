import type { RulesFixture } from '../../types.ts';
import {
  CITY_COUNCIL,
  FIRE_COMMISSIONER,
  HOSPITAL_COMMISSIONER,
  SCHOOL_DIRECTOR,
  WATER_SEWER_COMMISSIONER,
} from './offices.ts';

const ELECTION_DATES =
  'The 2025 Primary was held on August 5, 2025. … The 2025 General Election was held on November 4, 2025.';
const FILING_WEEK =
  'Candidate filing week for the 2025 election cycle was held from May 5 through May 9, 2025. Candidates were permitted to withdraw their declarations of candidacy at any time prior to May 12, 2025, at 5:00 p.m., in accordance with state law. … The 2025 General Election was held on November 4, 2025.';

const CONTESTS = [
  { date: '2025-08-05', kind: 'primary', party: null },
  { date: '2025-11-04', kind: 'general', party: null },
] as const;
const GENERAL = { date: '2025-11-04', kind: 'general', party: null } as const;
const WEEK = [
  {
    track: 'nonpartisan',
    opensOn: '2025-05-05',
    closesOn: '2025-05-09',
    withdrawalDeadline: '2025-05-12',
  },
] as const;

export const fixture: RulesFixture = {
  state: 'WA',
  source: {
    title: '2025 Annual Report of Washington State Elections',
    url: 'https://www.sos.wa.gov/sites/default/files/2026-01/2025%20Annual%20Elections%20Report_0.pdf',
    retrievedOn: '2026-11-27',
    sha256: '4530a1ea8083c45b9e87205ffbd6f18e81e7f33bf1c07ed5641b74d66e16475b',
  },
  contests: [
    {
      id: 'wa-2025-city-council-contests',
      office: CITY_COUNCIL,
      year: 2025,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
    {
      id: 'wa-2025-school-director-contests',
      office: SCHOOL_DIRECTOR,
      year: 2025,
      expect: CONTESTS,
      quote: ELECTION_DATES,
    },
  ],
  cases: [
    {
      id: 'wa-2025-city-council',
      office: CITY_COUNCIL,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2025-school-director',
      office: SCHOOL_DIRECTOR,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2025-fire-commissioner',
      office: FIRE_COMMISSIONER,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2025-water-sewer-commissioner',
      office: WATER_SEWER_COMMISSIONER,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2025-hospital-commissioner',
      office: HOSPITAL_COMMISSIONER,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
  ],
};
