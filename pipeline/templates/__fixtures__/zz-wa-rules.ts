// A rules module exporting only the schedule and track-set ids the worked Washington example
// names, so that the example's rules can be checked. It computes nothing.
import { federalHolidays } from '@citizenrun/rules';
import type { StateRules } from '@citizenrun/rules';

export const WA_EXAMPLE_RULES: StateRules = {
  state: 'WA',
  schedules: ['wa_county_general', 'wa_state_general', 'wa_local_odd_year', 'wa_state_primary'],
  trackSets: ['wa_filing_week'],
  holidays: (year) => ({ state: 'WA', year, holidays: federalHolidays(year) }),
  contests: () => [],
  filingTracks: () => [],
  certificationDate: () => null,
  countyPay: () => null,
};
