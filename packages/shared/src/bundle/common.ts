import { z } from 'zod';
import { SOURCE_URL_MAX, parseSafeUrl } from '../policy/links.ts'; // L-links

export const BUNDLE_SCHEMA_VERSION = 1;
/** Raised by one for each additive change: a new file or a new field. */
export const BUNDLE_SCHEMA_REVISION = 0;
/** The highest schema_revision the load core in this build accepts; J-bundle.poll writes it to loader.json (D-458). */
export const LOADER_SCHEMA_REVISION = BUNDLE_SCHEMA_REVISION;

// Refuses U+0000 to U+001F and U+007F; a code-unit check, because no lint rule may be disabled (D-804).
const noControl = (s: string) => {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }
  return true;
};
export const text = (max: number) =>
  z.string().min(1).max(max).refine(noControl, 'control character');

export const SourceKeySchema = text(600);
export const SlugSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/); // offices_slug_check
export const RefIdSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/); // issues, powers, office types
export const SafeUrlSchema = z
  .url({ protocol: /^https$/ })
  .max(SOURCE_URL_MAX)
  .refine((u) => parseSafeUrl(u, SOURCE_URL_MAX) !== null, 'not a safe URL'); // the one safe-URL check, L-links (D-474, D-536); links are https only
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/); // 24-hour HH:MM
export const IsoInstantSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
export const StateCodeSchema = z.string().regex(/^[A-Z]{2}$/);
export const PartySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/); // party key
export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const IanaZoneSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/);
export const Hex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const LevelSchema = z.enum(['local', 'county', 'state', 'federal', 'special']);
export const ElectionKindSchema = z.enum([
  'primary',
  'general',
  'primary_runoff',
  'general_runoff',
  'special',
]);
export const TrackSchema = z.enum([
  'party_primary',
  'independent',
  'nonpartisan',
  'write_in',
  'incumbent',
]);
export const TurnoutClassSchema = z.enum([
  'presidential_general',
  'midterm_general',
  'odd_year_general',
  'primary',
  'standalone_local',
  'odd_year_statewide',
  'spring_local',
  'spring_with_presidential_primary',
  'runoff',
]);
export const BallotLineSchema = z
  .string()
  .regex(/^(party:[a-z][a-z0-9_]{0,39}|independent|write_in)$/); // L-ballot-line
/** A path relative to the manifest's folder; may start with '../' only to reach another folder under bundles/ or assets/, or reports/coverage/ (the full manifest's coverage_path). */
export const RelPathSchema = z
  .string()
  .max(300)
  .regex(/^(\.\.\/){0,2}[A-Za-z0-9._/-]+$/);

/** The stored proof of one field value, with the optional keys rule_citation, population_source and population_year (D-439). */
export const FieldMetaRowSchema = z
  .strictObject({
    source_url: SafeUrlSchema.nullable(),
    quote: text(2000).nullable(),
    confidence: ConfidenceSchema,
    checked_at: IsoInstantSchema,
    rule_citation: text(300).optional(),
    population_source: z.enum(['census-gus', 'acs5', 'pl94171-block-sum']).optional(),
    population_year: z.int().min(2000).max(2100).optional(),
  })
  .refine(
    (m) => m.confidence === 'low' || (m.source_url !== null && m.quote !== null),
    'high and medium need source_url and quote',
  );
export const FieldMetaMapSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  FieldMetaRowSchema,
);

export type FieldMetaRow = z.infer<typeof FieldMetaRowSchema>;
export type FieldMetaMap = z.infer<typeof FieldMetaMapSchema>;
