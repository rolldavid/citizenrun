import { z } from 'zod';
import {
  BUNDLE_SCHEMA_VERSION,
  Hex64Schema,
  IsoDateSchema,
  IsoInstantSchema,
  RelPathSchema,
  SafeUrlSchema,
  SlugSchema,
  StateCodeSchema,
  text,
} from './common.ts';

export const BundleFileNameSchema = z.enum([
  'jurisdictions',
  'districts',
  'district_fallbacks',
  'offices',
  'office_powers',
  'elections',
  'filing_tracks',
  'results',
  'people',
  'person_aliases',
  'officeholders',
  'given_name_aliases',
  'power_phrases',
  'search_synonyms',
  'forms',
  'filings',
  'field_report_resolutions',
  'zip_centroids',
  'geometry',
]);
export type BundleFileName = z.infer<typeof BundleFileNameSchema>;

export const BundleManifestSchema = z
  .strictObject({
    format: z.literal('citizenrun-bundle'),
    kind: z.enum(['full', 'filings', 'geometry']),
    version: z.string().regex(/^(sample-)?\d{8}T\d{6}Z-(full|filings|geometry)$/), // 'sample-' only on the sample bundle
    schema_version: z.literal(BUNDLE_SCHEMA_VERSION),
    schema_revision: z.int().min(0),
    created_at: IsoInstantSchema,
    git_sha: z.string().regex(/^[0-9a-f]{40}$/),
    geometry_version: z
      .string()
      .regex(/^(sample-)?\d{8}T\d{6}Z-geometry$/)
      .nullable(), // required for 'full'; null otherwise
    tiger_vintage: z
      .string()
      .regex(/^\d{4}$/)
      .nullable(), // required for 'geometry'
    states: z.array(StateCodeSchema).min(1),
    files: z.array(
      z.strictObject({
        name: BundleFileNameSchema,
        state: StateCodeSchema.nullable(), // set only for 'geometry' files (one per state)
        path: RelPathSchema,
        sha256: Hex64Schema,
        bytes: z.int().min(0),
        rows: z.int().min(0),
      }),
    ),
    assets: z.array(
      z.strictObject({
        path: RelPathSchema, // '../../assets/photos/<sha256>.jpg'
        sha256: Hex64Schema,
        kind: z.enum(['photo', 'form']),
        bytes: z.int().min(1).max(20_000_000),
        content_type: z.enum(['image/jpeg', 'application/pdf']),
      }),
    ),
    datasets: z.record(
      z.string(),
      z.strictObject({
        edition: text(100),
        downloaded_on: IsoDateSchema,
        source_url: SafeUrlSchema,
      }),
    ),
    checks: z.array(z.strictObject({ name: text(80), passed: z.boolean(), detail: text(2000) })),
    filing_sources: z.array(
      z.strictObject({
        source: SlugSchema,
        state: StateCodeSchema,
        snapshot: z.enum(['full', 'none']),
        fetched_at: IsoInstantSchema.nullable(),
        rows: z.int().min(0),
      }),
    ),
    two_source_fields: z.int().min(0),
    coverage_path: RelPathSchema.nullable(), // '../../reports/coverage/<version>.json'
    attribution_path: RelPathSchema.nullable(),
  })
  .refine(
    (m) =>
      m.geometry_version === null ||
      m.version.startsWith('sample-') === m.geometry_version.startsWith('sample-'),
    'sample and real versions mixed',
  );
export type BundleManifest = z.infer<typeof BundleManifestSchema>;
