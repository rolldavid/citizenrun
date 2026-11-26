import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BElectionSchema,
  BFilingTrackSchema,
  BGeometrySchema,
  BGivenNameAliasSchema,
  BJurisdictionSchema,
  BOfficeholderSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BPersonAliasSchema,
  BPersonSchema,
  BZipCentroidSchema,
} from '@citizenrun/shared';
import type { CivicTable } from '@citizenrun/shared';
import type { z } from 'zod';

/** PIPE-loader's staging order for the files of schema revision 0. */
export const FULL_FILES_R0 = [
  'jurisdictions',
  'districts',
  'district_fallbacks',
  'offices',
  'office_powers',
  'elections',
  'filing_tracks',
  'people',
  'person_aliases',
  'given_name_aliases',
  'officeholders',
] as const;
export type FullFileR0 = (typeof FULL_FILES_R0)[number];

/** The strict row schema of each file, imported from @citizenrun/shared. */
export const ROW_SCHEMAS: { readonly [F in FullFileR0 | 'zip_centroids' | 'geometry']: z.ZodType } =
  {
    jurisdictions: BJurisdictionSchema,
    districts: BDistrictSchema,
    district_fallbacks: BDistrictFallbackSchema,
    offices: BOfficeSchema,
    office_powers: BOfficePowerSchema,
    elections: BElectionSchema,
    filing_tracks: BFilingTrackSchema,
    people: BPersonSchema,
    person_aliases: BPersonAliasSchema,
    given_name_aliases: BGivenNameAliasSchema,
    officeholders: BOfficeholderSchema,
    zip_centroids: BZipCentroidSchema,
    geometry: BGeometrySchema,
  };

/** The civic table whose id civicId gives; null for files whose table has a composite key. */
export const CIVIC_ID_TABLE: { readonly [F in FullFileR0 | 'zip_centroids']: CivicTable | null } = {
  jurisdictions: 'jurisdictions',
  districts: 'districts',
  district_fallbacks: null,
  offices: 'offices',
  office_powers: null,
  elections: 'elections',
  filing_tracks: 'filing_tracks',
  people: 'people',
  person_aliases: null,
  given_name_aliases: null,
  officeholders: 'officeholders',
  zip_centroids: null,
};

/** True when `name` is a file of FULL_FILES_R0. */
export function isFullFileR0(name: string): name is FullFileR0 {
  return (FULL_FILES_R0 as readonly string[]).includes(name);
}
