import type { FixtureTrackExpect, RulesFixture } from '../../types.ts';
import { casesFor, OTHER_PARTISAN, US_HOUSE, US_SENATE } from './offices.ts';

const STATE_BOARD =
  'Deadline for petitioner to file signature pages with the State Board: 12:00 noon on March 3, 2026 (the day of the 2026 primary).';
const COUNTY_BOARD =
  'Deadline for petitioner to file signature pages with the county board: 12:00 noon on March 3, 2026 (the day of the 2026 primary).';

const GENERAL = { date: '2026-11-03', kind: 'general', party: null } as const;
const DUE: FixtureTrackExpect = {
  track: 'independent',
  closesOn: '2026-03-03',
  closesTime: '12:00',
  petitionDue: '2026-03-03',
};

const {
  supremeCourt,
  superiorCourt,
  stateSenator,
  stateRepresentative,
  countyCommissioner,
  sheriff,
  countyTreasurer,
  clerkOfSuperiorCourt,
} = OTHER_PARTISAN;
const county = { countyCommissioner, sheriff, countyTreasurer, clerkOfSuperiorCourt };

// The fact sheet names no district attorney petition for 2026, and the Council of State is not
// elected in 2026; neither has a case here.
export const fixture: RulesFixture = {
  state: 'NC',
  source: {
    title: 'State Board of Elections Unaffiliated Candidate Fact Sheet Revised 01/15/2025',
    url: 'https://dl.ncsbe.gov/Candidate%20Filing/2026_Fact_Sheet_Unaffiliated_Candidate.pdf',
    retrievedOn: '2026-11-27',
    sha256: 'f0d358fa4307f3a6ea05044fad5d9896251cc34e30cf98ae0a87e34fa92abce0',
  },
  contests: [],
  cases: [
    ...casesFor(
      'nc-2026-unaffiliated',
      {
        usSenate: US_SENATE,
        supremeCourt,
        usHouse: US_HOUSE,
        stateSenator,
        stateRepresentative,
        superiorCourt,
      },
      GENERAL,
      DUE,
      STATE_BOARD,
    ),
    ...casesFor('nc-2026-unaffiliated', county, GENERAL, DUE, COUNTY_BOARD),
  ],
};
