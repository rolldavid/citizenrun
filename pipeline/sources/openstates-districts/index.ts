// The one place a state's Open States district labels are turned into TIGER GEOIDs (D-313). A
// state with named districts gets its own label table beside this file; until then every state
// uses the numbered mapper. The caller accepts a GEOID only when stage 1 has that district.
import { numberedGeoid } from './numbered.ts';

export type DistrictMapper = (chamber: 'upper' | 'lower', label: string) => string | null;

/** The mapper of a state's labels. */
export function mapperFor(_state: string, stateFips: string): DistrictMapper {
  return (_chamber, label) => numberedGeoid(stateFips, label);
}
