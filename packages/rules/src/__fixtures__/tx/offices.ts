// The offices the Texas fixtures ask about: one office of each kind, stating only the keys the
// module reads (fixtureOffice). Not a fixture file; the fixtures import it.
import type { RulesFixture } from '../../types.ts';

export type FixtureOfficeRef = RulesFixture['cases'][number]['office'];

function stateOffice(templateKey: string, officeTypeId: string): FixtureOfficeRef {
  return {
    templateKey,
    officeTypeId,
    jurisdictionKind: 'state',
    partisan: true,
    schedule: 'tx_state_general',
    trackSet: 'tx_partisan',
  };
}

function countyOffice(templateKey: string, officeTypeId: string): FixtureOfficeRef {
  return {
    templateKey,
    officeTypeId,
    jurisdictionKind: 'county',
    partisan: true,
    population: null,
    schedule: 'tx_county_general',
    trackSet: 'tx_partisan',
  };
}

/** One office of each office type Texas nominates at party primaries (§ 172.001). */
export const PARTISAN_OFFICES = {
  usSenate: stateOffice('us-senator', 'us-senate'),
  usHouse: stateOffice('us-representative', 'us-house'),
  governor: stateOffice('governor', 'governor'),
  lieutenantGovernor: stateOffice('lieutenant-governor', 'statewide-executive-other'),
  attorneyGeneral: stateOffice('attorney-general', 'attorney-general'),
  comptroller: stateOffice('comptroller', 'state-treasurer'),
  railroadCommissioner: stateOffice('railroad-commissioner', 'oil-gas-land-commission'),
  boardOfEducation: stateOffice('state-board-of-education-member', 'state-education-board'),
  supremeCourt: stateOffice('supreme-court-justice', 'state-appellate-judge'),
  stateSenator: stateOffice('state-senator', 'state-senate'),
  stateRepresentative: stateOffice('state-representative', 'state-house'),
  districtAttorney: stateOffice('district-attorney', 'district-attorney'),
  districtJudge: stateOffice('district-judge', 'trial-judge'),
  countyJudge: countyOffice('county-judge', 'county-executive'),
  countyCommissioner: countyOffice('county-commissioner', 'county-commission'),
  countyClerk: countyOffice('county-clerk', 'county-clerk'),
  countyTreasurer: countyOffice('county-treasurer', 'county-treasurer'),
  taxAssessorCollector: countyOffice('tax-assessor-collector', 'county-assessor'),
  sheriff: countyOffice('sheriff', 'sheriff'),
  constable: countyOffice('constable', 'county-row-other'),
} as const satisfies Record<string, FixtureOfficeRef>;

export const PRECINCT_CHAIR: FixtureOfficeRef = {
  templateKey: 'precinct-chair',
  officeTypeId: 'party-precinct-committee',
  jurisdictionKind: 'party',
  schedule: 'tx_party_primary',
  trackSet: 'tx_party_office',
};

export const COUNTY_CHAIR: FixtureOfficeRef = {
  templateKey: 'county-chair',
  officeTypeId: 'party-committee',
  jurisdictionKind: 'party',
  schedule: 'tx_party_primary',
  trackSet: 'tx_party_office',
};

export function cityCouncil(schedule: 'tx_uniform_may' | 'tx_uniform_november'): FixtureOfficeRef {
  return {
    templateKey: 'city-council-member',
    officeTypeId: 'city-council',
    jurisdictionKind: 'city',
    schedule,
    trackSet: 'tx_local',
  };
}

export function schoolTrustee(
  schedule: 'tx_uniform_may' | 'tx_uniform_november',
): FixtureOfficeRef {
  return {
    templateKey: 'school-trustee',
    officeTypeId: 'school-board',
    jurisdictionKind: 'school_district',
    schedule,
    trackSet: 'tx_local',
  };
}
