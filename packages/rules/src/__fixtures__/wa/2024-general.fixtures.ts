import type { RulesFixture } from '../../types.ts';
import { COUNTY_COMMISSIONER, GOVERNOR, SHERIFF, STATE_HOUSE, US_HOUSE } from './offices.ts';

const FILING_WEEK =
  'The General Election, held on November 5, 2024 … Candidate filing for 2024 was May 6th through May 10th, and the deadline to withdraw was the following Monday, May 13th.';

const GENERAL = { date: '2024-11-05', kind: 'general', party: null } as const;
const WEEK = [
  {
    track: 'nonpartisan',
    opensOn: '2024-05-06',
    closesOn: '2024-05-10',
    withdrawalDeadline: '2024-05-13',
  },
] as const;

export const fixture: RulesFixture = {
  state: 'WA',
  source: {
    title: '2024 Annual Report of Washington State Elections',
    url: 'https://www.sos.wa.gov/sites/default/files/2025-02/2024%20Annual%20Elections%20Report.pdf',
    retrievedOn: '2026-11-27',
    sha256: '380cc39e908cf60980aaf94daac25084ab98d2dd30363c6c022e468cc7ce95a1',
  },
  contests: [],
  cases: [
    {
      id: 'wa-2024-governor',
      office: GOVERNOR,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2024-us-house',
      office: US_HOUSE,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2024-state-house',
      office: STATE_HOUSE,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2024-county-commissioner',
      office: COUNTY_COMMISSIONER,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
    {
      id: 'wa-2024-sheriff',
      office: SHERIFF,
      contest: GENERAL,
      expect: WEEK,
      quote: FILING_WEEK,
    },
  ],
};
