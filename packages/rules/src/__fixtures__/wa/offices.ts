// The fixture offices of Washington's fixtures: only the keys the module reads.
type Office = {
  readonly templateKey: string;
  readonly officeTypeId: string;
  readonly schedule: string;
  readonly trackSet: string;
};

function office(templateKey: string, officeTypeId: string, schedule: string): Office {
  return { templateKey, officeTypeId, schedule, trackSet: 'wa_filing_week' };
}

export const GOVERNOR = office('governor', 'governor', 'wa_state_general');
export const US_HOUSE = office('us-house', 'us-house', 'wa_state_general');
export const STATE_SENATE = office('state-senate', 'state-senate', 'wa_state_general');
export const STATE_HOUSE = office('state-house', 'state-house', 'wa_state_general');
export const SUPERIOR_COURT = office('superior-court-judge', 'trial-judge', 'wa_state_general');
export const COUNTY_COMMISSIONER = office(
  'county-commissioner',
  'county-commission',
  'wa_county_general',
);
export const SHERIFF = office('sheriff', 'sheriff', 'wa_county_general');
export const PRECINCT_COMMITTEE_OFFICER = office(
  'precinct-committee-officer',
  'party-precinct-committee',
  'wa_state_primary',
);
export const CITY_COUNCIL = office('city-council', 'city-council', 'wa_local_odd_year');
export const MAYOR = office('mayor', 'mayor', 'wa_local_odd_year');
export const SCHOOL_DIRECTOR = office('school-director', 'school-board', 'wa_local_odd_year');
export const FIRE_COMMISSIONER = office(
  'fire-commissioner',
  'fire-district-board',
  'wa_local_odd_year',
);
export const WATER_SEWER_COMMISSIONER = office(
  'water-sewer-commissioner',
  'water-district-board',
  'wa_local_odd_year',
);
export const HOSPITAL_COMMISSIONER = office(
  'hospital-commissioner',
  'hospital-district-board',
  'wa_local_odd_year',
);
