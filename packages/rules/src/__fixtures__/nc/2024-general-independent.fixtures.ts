import type { FixtureTrackExpect, RulesFixture } from '../../types.ts';
import { casesFor, COUNCIL_OF_STATE, OTHER_PARTISAN, US_HOUSE } from './offices.ts';

const STATE_BOARD =
  'The petitioner must file signature pages with the State Board of Elections by noon on the day of the primary. In 2024, this deadline is 12:00 noon on March 5, 2024.';
const COUNTY_BOARD =
  'The petitioner must file signature pages with the county board of elections by noon on the day of the primary. In 2024, this deadline is 12:00 noon on March 5, 2024.';

const GENERAL = { date: '2024-11-05', kind: 'general', party: null } as const;
const DUE: FixtureTrackExpect = {
  track: 'independent',
  closesOn: '2024-03-05',
  closesTime: '12:00',
  petitionDue: '2024-03-05',
};

const {
  supremeCourt,
  superiorCourt,
  districtAttorney,
  stateSenator,
  stateRepresentative,
  ...county
} = OTHER_PARTISAN;

// No U.S. Senate seat was on the 2024 ballot.
export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'State Board of Elections Unaffiliated Candidate Fact Sheet Revised 02/24/2023',
    url: 'https://dl.ncsbe.gov/Candidate%20Filing/2024_Fact_Sheet_Unaffiliated_Candidate.pdf',
    retrievedOn: '2026-11-27',
    sha256: '2be8b096a1b3cc0137b2936374945d18c7e11284986310d72cb5319b271e6273',
  },
  contests: [],
  cases: [
    ...casesFor(
      'nc-2024-unaffiliated',
      {
        ...COUNCIL_OF_STATE,
        supremeCourt,
        usHouse: US_HOUSE,
        districtAttorney,
        stateSenator,
        stateRepresentative,
        superiorCourt,
      },
      GENERAL,
      DUE,
      STATE_BOARD,
    ),
    ...casesFor('nc-2024-unaffiliated', county, GENERAL, DUE, COUNTY_BOARD),
  ],
};
