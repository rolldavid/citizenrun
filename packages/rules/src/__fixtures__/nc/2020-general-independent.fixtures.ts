import type { FixtureTrackExpect, RulesFixture } from '../../types.ts';
import { casesFor, COUNCIL_OF_STATE, OTHER_PARTISAN, US_HOUSE, US_SENATE } from './offices.ts';

const STATEWIDE =
  'The petitioner must file signature pages with the appropriate county board of elections by noon on the day of the primary. This deadline is noon on March 3, 2020.';
const DISTRICT =
  'The petitioner must file signature pages with the involved county boards of election by noon on the day of the primary. This deadline is 12:00 noon on March 3, 2020.';
const JUDGES =
  'The petitioner must file signature pages with the involved county boards of election by noon the day of the primary. This deadline is noon on March 3, 2020.';
const COUNTY =
  'The petitioner must file signature pages with the county board of elections by noon on the day of the primary. In 2020, the deadline is noon on March 3rd.';

const GENERAL = { date: '2020-11-03', kind: 'general', party: null } as const;
const DUE: FixtureTrackExpect = {
  track: 'independent',
  closesOn: '2020-03-03',
  closesTime: '12:00',
  petitionDue: '2020-03-03',
};

const {
  supremeCourt,
  superiorCourt,
  districtAttorney,
  stateSenator,
  stateRepresentative,
  ...county
} = OTHER_PARTISAN;

export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'Unaffiliated Candidates for Elections in 2020',
    url: 'https://dl.ncsbe.gov/Candidate%20Filing/Petitions/2020%20Unaffiliated%20Candidate.pdf',
    retrievedOn: '2026-11-27',
    sha256: '32f264bab4afdff14e2a9c7ad30603fcbc003e80ed02c5340684e643461dfb6a',
  },
  contests: [],
  cases: [
    ...casesFor(
      'nc-2020-unaffiliated',
      { usSenate: US_SENATE, ...COUNCIL_OF_STATE, supremeCourt },
      GENERAL,
      DUE,
      STATEWIDE,
    ),
    ...casesFor(
      'nc-2020-unaffiliated',
      { usHouse: US_HOUSE, districtAttorney, stateSenator, stateRepresentative },
      GENERAL,
      DUE,
      DISTRICT,
    ),
    ...casesFor('nc-2020-unaffiliated', { superiorCourt }, GENERAL, DUE, JUDGES),
    ...casesFor('nc-2020-unaffiliated', county, GENERAL, DUE, COUNTY),
  ],
};
