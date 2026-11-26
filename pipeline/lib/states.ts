/** One of the 50 states or the District of Columbia. */
export type PipelineState = { readonly code: string; readonly fips: string; readonly name: string };

/** A code that is not one of the 50 states or DC. */
export class UnknownStateError extends Error {
  override readonly name = 'UnknownStateError';

  constructor(code: string) {
    super(`unknown state code ${code}`);
  }
}

/**
 * The 50 states and DC, ordered by FIPS code: postal code, two-digit FIPS code and name, copied
 * from the Census Bureau's list of ANSI codes for states,
 * https://www.census.gov/library/reference/code-lists/ansi/ansi-codes-for-states.html
 * No territory is listed. The base load checks this table against the TIGER state layer.
 */
export const PIPELINE_STATES: readonly PipelineState[] = Object.freeze(
  [
    { code: 'AL', fips: '01', name: 'Alabama' },
    { code: 'AK', fips: '02', name: 'Alaska' },
    { code: 'AZ', fips: '04', name: 'Arizona' },
    { code: 'AR', fips: '05', name: 'Arkansas' },
    { code: 'CA', fips: '06', name: 'California' },
    { code: 'CO', fips: '08', name: 'Colorado' },
    { code: 'CT', fips: '09', name: 'Connecticut' },
    { code: 'DE', fips: '10', name: 'Delaware' },
    { code: 'DC', fips: '11', name: 'District of Columbia' },
    { code: 'FL', fips: '12', name: 'Florida' },
    { code: 'GA', fips: '13', name: 'Georgia' },
    { code: 'HI', fips: '15', name: 'Hawaii' },
    { code: 'ID', fips: '16', name: 'Idaho' },
    { code: 'IL', fips: '17', name: 'Illinois' },
    { code: 'IN', fips: '18', name: 'Indiana' },
    { code: 'IA', fips: '19', name: 'Iowa' },
    { code: 'KS', fips: '20', name: 'Kansas' },
    { code: 'KY', fips: '21', name: 'Kentucky' },
    { code: 'LA', fips: '22', name: 'Louisiana' },
    { code: 'ME', fips: '23', name: 'Maine' },
    { code: 'MD', fips: '24', name: 'Maryland' },
    { code: 'MA', fips: '25', name: 'Massachusetts' },
    { code: 'MI', fips: '26', name: 'Michigan' },
    { code: 'MN', fips: '27', name: 'Minnesota' },
    { code: 'MS', fips: '28', name: 'Mississippi' },
    { code: 'MO', fips: '29', name: 'Missouri' },
    { code: 'MT', fips: '30', name: 'Montana' },
    { code: 'NE', fips: '31', name: 'Nebraska' },
    { code: 'NV', fips: '32', name: 'Nevada' },
    { code: 'NH', fips: '33', name: 'New Hampshire' },
    { code: 'NJ', fips: '34', name: 'New Jersey' },
    { code: 'NM', fips: '35', name: 'New Mexico' },
    { code: 'NY', fips: '36', name: 'New York' },
    { code: 'NC', fips: '37', name: 'North Carolina' },
    { code: 'ND', fips: '38', name: 'North Dakota' },
    { code: 'OH', fips: '39', name: 'Ohio' },
    { code: 'OK', fips: '40', name: 'Oklahoma' },
    { code: 'OR', fips: '41', name: 'Oregon' },
    { code: 'PA', fips: '42', name: 'Pennsylvania' },
    { code: 'RI', fips: '44', name: 'Rhode Island' },
    { code: 'SC', fips: '45', name: 'South Carolina' },
    { code: 'SD', fips: '46', name: 'South Dakota' },
    { code: 'TN', fips: '47', name: 'Tennessee' },
    { code: 'TX', fips: '48', name: 'Texas' },
    { code: 'UT', fips: '49', name: 'Utah' },
    { code: 'VT', fips: '50', name: 'Vermont' },
    { code: 'VA', fips: '51', name: 'Virginia' },
    { code: 'WA', fips: '53', name: 'Washington' },
    { code: 'WV', fips: '54', name: 'West Virginia' },
    { code: 'WI', fips: '55', name: 'Wisconsin' },
    { code: 'WY', fips: '56', name: 'Wyoming' },
  ].map((row) => Object.freeze(row)),
);

const BY_CODE: ReadonlyMap<string, PipelineState> = new Map(
  PIPELINE_STATES.map((row) => [row.code, row]),
);
const BY_FIPS: ReadonlyMap<string, PipelineState> = new Map(
  PIPELINE_STATES.map((row) => [row.fips, row]),
);

/** The state with this postal code; throws UnknownStateError for any other code. */
export function stateByCode(code: string): PipelineState {
  const found = BY_CODE.get(code);
  if (found === undefined) {
    throw new UnknownStateError(code);
  }
  return found;
}

/** The state with this two-digit FIPS code, or null. */
export function stateByFips(fips: string): PipelineState | null {
  return BY_FIPS.get(fips) ?? null;
}
