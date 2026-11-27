// The offices the North Carolina fixtures ask about: one office of each kind, stating only the keys
// the module reads (fixtureOffice). Not a fixture file; the fixtures import it.
import type { FixtureTrackExpect, RulesFixture } from '../../types.ts';

export type FixtureOfficeRef = RulesFixture['cases'][number]['office'];
type FixtureCase = RulesFixture['cases'][number];

function partisanOffice(
  templateKey: string,
  officeTypeId: string,
  jurisdictionKind: 'state' | 'county',
  schedule: 'nc_state_general' | 'nc_state_general_quadrennial' = 'nc_state_general',
): FixtureOfficeRef {
  return {
    templateKey,
    officeTypeId,
    jurisdictionKind,
    partisan: true,
    schedule,
    trackSet: 'nc_partisan',
  };
}

/** The Council of State offices, elected in 1968 and every four years after (G.S. 163-1(a)). */
export const COUNCIL_OF_STATE = {
  governor: partisanOffice('governor', 'governor', 'state', 'nc_state_general_quadrennial'),
  lieutenantGovernor: partisanOffice(
    'lieutenant-governor',
    'statewide-executive-other',
    'state',
    'nc_state_general_quadrennial',
  ),
  attorneyGeneral: partisanOffice(
    'attorney-general',
    'attorney-general',
    'state',
    'nc_state_general_quadrennial',
  ),
  secretaryOfState: partisanOffice(
    'secretary-of-state',
    'secretary-of-state',
    'state',
    'nc_state_general_quadrennial',
  ),
  treasurer: partisanOffice('treasurer', 'state-treasurer', 'state', 'nc_state_general_quadrennial'),
  insuranceCommissioner: partisanOffice(
    'commissioner-of-insurance',
    'insurance-commissioner',
    'state',
    'nc_state_general_quadrennial',
  ),
  laborCommissioner: partisanOffice(
    'commissioner-of-labor',
    'labor-commissioner',
    'state',
    'nc_state_general_quadrennial',
  ),
} as const;

export const US_SENATE = partisanOffice('us-senator', 'us-senate', 'state');
export const US_HOUSE = partisanOffice('us-representative', 'us-house', 'state');

/** The partisan offices on the biennial ballot other than the federal ones. */
export const OTHER_PARTISAN = {
  supremeCourt: partisanOffice('supreme-court-justice', 'state-appellate-judge', 'state'),
  superiorCourt: partisanOffice('superior-court-judge', 'trial-judge', 'state'),
  districtAttorney: partisanOffice('district-attorney', 'district-attorney', 'state'),
  stateSenator: partisanOffice('state-senator', 'state-senate', 'state'),
  stateRepresentative: partisanOffice('state-representative', 'state-house', 'state'),
  countyCommissioner: partisanOffice('county-commissioner', 'county-commission', 'county'),
  sheriff: partisanOffice('sheriff', 'sheriff', 'county'),
  countyTreasurer: partisanOffice('county-treasurer', 'county-treasurer', 'county'),
  clerkOfSuperiorCourt: partisanOffice('clerk-of-superior-court', 'county-row-other', 'county'),
} as const;

export const SCHOOL_BOARD: FixtureOfficeRef = {
  templateKey: 'board-of-education',
  officeTypeId: 'school-board',
  jurisdictionKind: 'school_district',
  partisan: false,
  schedule: 'nc_school',
  trackSet: 'nc_nonpartisan',
};

export const CITY_COUNCIL: FixtureOfficeRef = {
  templateKey: 'city-council',
  officeTypeId: 'city-council',
  jurisdictionKind: 'city',
  partisan: false,
  schedule: 'nc_municipal',
  trackSet: 'nc_municipal',
};

export const SOIL_WATER_SUPERVISOR: FixtureOfficeRef = {
  templateKey: 'soil-water-supervisor',
  officeTypeId: 'soil-water-conservation-board',
  jurisdictionKind: 'special_district',
  partisan: false,
  schedule: 'nc_soil_water',
  trackSet: 'nc_soil_water',
};

/** One case per office of `offices`, each with the same contest, expectation and quote. */
export function casesFor(
  prefix: string,
  offices: Readonly<Record<string, FixtureOfficeRef>>,
  contest: FixtureCase['contest'],
  expect: FixtureTrackExpect,
  quote: string,
): FixtureCase[] {
  return Object.entries(offices).map(([name, office]) => ({
    id: `${prefix}-${name}`,
    office,
    contest,
    expect: [expect],
    quote,
  }));
}
