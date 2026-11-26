import { z } from 'zod';
import {
  ConfidenceSchema,
  ElectionKindSchema,
  FieldMetaMapSchema,
  Hex64Schema,
  IanaZoneSchema,
  IsoDateSchema,
  IsoInstantSchema,
  LevelSchema,
  LocalTimeSchema,
  PartySchema,
  RefIdSchema,
  RelPathSchema,
  SafeUrlSchema,
  SlugSchema,
  SourceKeySchema,
  StateCodeSchema,
  TrackSchema,
  TurnoutClassSchema,
  text,
} from './common.ts';

export const BJurisdictionSchema = z.strictObject({
  source_key: SourceKeySchema,
  kind: z.enum([
    'state',
    'county',
    'city',
    'township',
    'school_district',
    'special_district',
    'coop',
    'party',
  ]),
  name: text(200),
  state: StateCodeSchema,
  census_id: z
    .string()
    .regex(/^\d{6}$/)
    .nullable(),
  parent_key: SourceKeySchema.nullable(),
  population: z.int().min(0).nullable(),
  website: SafeUrlSchema.nullable(),
  timezone: IanaZoneSchema.nullable(),
  budget_cents: z.int().min(0).nullable(),
  budget_year: z.int().min(1990).max(2100).nullable(),
  census_active: z.boolean().nullable(),
  label_lng: z.number().min(-180).max(180).nullable(), // jurisdictions.label_point; null with no exact boundary
  label_lat: z.number().min(-90).max(90).nullable(),
  field_meta: FieldMetaMapSchema,
});
export type BJurisdiction = z.infer<typeof BJurisdictionSchema>;

export const BDistrictSchema = z.strictObject({
  source_key: SourceKeySchema,
  jurisdiction_key: SourceKeySchema,
  name: text(200),
  level: LevelSchema,
  geometry_quality: z.enum(['exact', 'parent_fallback', 'county_approx']),
  geom_hash: Hex64Schema, // equals the geometry row's geom_hash
  population: z.int().min(0).nullable(),
  population_18: z.int().min(0).nullable(),
  lean: z.number().min(-100).max(100).nullable(),
  lean_basis: z.enum(['precinct', 'county', 'precinct_2020_county_swing']).nullable(),
  field_meta: FieldMetaMapSchema,
});
export type BDistrict = z.infer<typeof BDistrictSchema>;

export const BDistrictFallbackSchema = z.strictObject({
  source_key: SourceKeySchema, // '<district key>|<via district key>'
  district_key: SourceKeySchema, // geometry_quality is not 'exact'
  via_district_key: SourceKeySchema, // geometry_quality is 'exact'
});
export type BDistrictFallback = z.infer<typeof BDistrictFallbackSchema>;

export const BGeometrySchema = z.strictObject({
  source_key: SourceKeySchema, // the district key
  lookup_wkb: z
    .string()
    .regex(/^[0-9a-f]+$/)
    .max(100_000_000)
    .nullable(), // published shape; exact districts only
  display_wkb: z
    .string()
    .regex(/^[0-9a-f]+$/)
    .max(50_000_000)
    .nullable(), // land-clipped, ~10 m; exact districts only
  label_point: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).nullable(),
  outline_svg: z
    .string()
    .max(20_000)
    .regex(/^[MLHVZmlhvz0-9 ,.-]+$/)
    .nullable(), // districts_outline_svg_check
  outline_bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  geom_hash: Hex64Schema,
});
export type BGeometry = z.infer<typeof BGeometrySchema>;

export const BZipCentroidSchema = z.strictObject({
  source_key: z.string().regex(/^zcta:\d{5}$/),
  zip: z.string().regex(/^\d{5}$/),
  state: StateCodeSchema,
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});
export type BZipCentroid = z.infer<typeof BZipCentroidSchema>;

export const EligibilityItemSchema = z.strictObject({
  kind: z.enum([
    'min_age',
    'residency',
    'registered_voter',
    'party_member',
    'outside_employment_ban',
    'resign_to_run',
    'other',
  ]),
  value: text(300),
  quote: text(2000).nullable(),
  source_url: SafeUrlSchema.nullable(),
  confidence: ConfidenceSchema,
});
export type EligibilityItem = z.infer<typeof EligibilityItemSchema>;

export const BOfficeSchema = z
  .strictObject({
    source_key: SlugSchema, // equals slug
    slug: SlugSchema,
    jurisdiction_key: SourceKeySchema,
    district_key: SourceKeySchema,
    office_type_id: RefIdSchema,
    title: text(200),
    placeholder: z.boolean(),
    seats: z.int().min(1).max(200),
    body_size: z.int().min(1).max(500).nullable(),
    seats_up_next: z.int().min(0).max(500).nullable(),
    vacant_seats_up_next: z.int().min(0).max(500).nullable(), // null until a source states it (PC-62)
    term_years: z.number().positive().max(15).nullable(),
    term_limit_terms: z.int().min(1).max(10).nullable(),
    partisan: z.boolean().nullable(),
    party_selection: z.enum(['primary_ballot', 'caucus', 'party_meeting']).nullable(), // party committee offices only (D-318, PC-64)
    electorate: z.int().min(0).nullable(),
    pay_annual_cents: z.int().min(0).nullable(),
    pay_kind: z.enum(['salary', 'stipend', 'per_meeting', 'none']).nullable(),
    pay_amount_cents: z.int().min(0).nullable(),
    pay_period: z.enum(['year', 'month', 'meeting']).nullable(),
    pay_change_note: text(500).nullable(),
    benefits: z
      .array(z.enum(['health', 'retirement', 'other']))
      .max(3)
      .nullable(),
    hours_per_week: z.number().positive().max(80).nullable(),
    full_time: z.boolean().nullable(),
    meeting_times: z
      .array(z.enum(['daytime', 'evenings', 'weekends']))
      .max(3)
      .nullable(),
    fits_day_job: z.enum(['yes', 'likely', 'no']).nullable(),
    filing_fee_cents: z.int().min(0).nullable(),
    signatures_required: z.int().min(0).nullable(),
    where_to_file: text(500).nullable(),
    eligibility: z.array(EligibilityItemSchema).max(30).nullable(),
    field_meta: FieldMetaMapSchema,
  })
  .refine((o) => o.seats_up_next === null || o.body_size === null || o.seats_up_next <= o.body_size)
  .refine(
    (o) =>
      o.vacant_seats_up_next === null ||
      o.seats_up_next === null ||
      o.vacant_seats_up_next <= o.seats_up_next,
  ) // offices_vacant_seats_up_next_check
  .refine(
    (o) =>
      o.party_selection === null ||
      o.office_type_id === 'party-precinct-committee' ||
      o.office_type_id === 'party-committee',
  ) // party_selection only on party committee offices
  .refine(
    (o) =>
      !o.placeholder ||
      (o.pay_annual_cents === null &&
        o.filing_fee_cents === null &&
        o.signatures_required === null &&
        o.where_to_file === null),
  ); // a placeholder office has no pay, fee, signatures or where-to-file
export type BOffice = z.infer<typeof BOfficeSchema>;

export const BOfficePowerSchema = z
  .strictObject({
    source_key: SourceKeySchema,
    office_key: SlugSchema,
    power_id: RefIdSchema,
    relevance: z.int().min(1).max(3),
    quote: text(2000).nullable(),
    source_url: SafeUrlSchema.nullable(),
    confidence: ConfidenceSchema,
    checked_at: IsoInstantSchema.nullable(),
  })
  .refine((p) => p.confidence === 'low' || (p.quote !== null && p.source_url !== null));
export type BOfficePower = z.infer<typeof BOfficePowerSchema>;

export const DeadlineConflictSchema = z.strictObject({
  track: TrackSchema,
  field: z.enum(['opens_on', 'closes_on', 'closes_time', 'petition_opens', 'petition_due']),
  computed: z.strictObject({ value: text(10), rule_citation: text(300) }),
  scraped: z.strictObject({
    value: text(10),
    source_url: SafeUrlSchema,
    quote: text(2000),
    checked_at: IsoInstantSchema,
  }),
});
export type DeadlineConflict = z.infer<typeof DeadlineConflictSchema>;

export const BElectionSchema = z.strictObject({
  source_key: SourceKeySchema,
  office_key: SlugSchema,
  election_date: IsoDateSchema,
  kind: ElectionKindSchema,
  party: PartySchema.nullable(),
  turnout_class: TurnoutClassSchema,
  deadline_conflict: z.array(DeadlineConflictSchema).min(1).max(20).nullable(),
  field_meta: FieldMetaMapSchema, // proof for election_date only
});
export type BElection = z.infer<typeof BElectionSchema>;

export const BFilingTrackSchema = z
  .strictObject({
    source_key: SourceKeySchema,
    election_key: SourceKeySchema,
    track: TrackSchema,
    opens_on: IsoDateSchema.nullable(),
    closes_on: IsoDateSchema.nullable(),
    closes_time: LocalTimeSchema.nullable(), // null unless a source states the hour
    petition_opens: IsoDateSchema.nullable(),
    petition_due: IsoDateSchema.nullable(),
    fee_cents: z.int().min(0).nullable(),
    signatures: z.int().min(0).nullable(),
    where_to_file: text(500).nullable(),
    basis: z.enum(['computed', 'scraped', 'both']),
    source_url: SafeUrlSchema.nullable(),
    quote: text(2000).nullable(),
    rule_citation: text(300).nullable(),
    confidence: ConfidenceSchema,
    checked_at: IsoInstantSchema,
    field_meta: FieldMetaMapSchema,
  })
  .refine((t) => t.confidence === 'low' || (t.source_url !== null && t.quote !== null)) // at low only quote may be null on a track that holds a value (D-598)
  .refine(
    (t) =>
      t.source_url !== null ||
      [
        t.opens_on,
        t.closes_on,
        t.closes_time,
        t.petition_opens,
        t.petition_due,
        t.fee_cents,
        t.signatures,
        t.where_to_file,
      ].every((v) => v === null),
  ) // a track that holds a value has its https source (D-598)
  .refine((t) => t.opens_on === null || t.closes_on === null || t.opens_on <= t.closes_on)
  .refine((t) => t.closes_time === null || t.closes_on !== null);
export type BFilingTrack = z.infer<typeof BFilingTrackSchema>;

export const PhotoRecordSchema = z.strictObject({
  // every field or no photo (D-333)
  asset: RelPathSchema, // '../../assets/photos/<sha256>.jpg'
  width: z.int().min(1).max(4000),
  height: z.int().min(1).max(8000),
  source_url: SafeUrlSchema,
  author: text(300),
  license: z.enum([
    'CC0-1.0',
    'CC-BY-1.0',
    'CC-BY-2.0',
    'CC-BY-2.5',
    'CC-BY-3.0',
    'CC-BY-4.0',
    'LicenseRef-PD',
    'LicenseRef-PD-USGov',
  ]),
  license_url: SafeUrlSchema,
  credit_text: text(400),
  modified: z.boolean(),
  retrieved_at: IsoInstantSchema,
});
export type PhotoRecord = z.infer<typeof PhotoRecordSchema>;

export const BPersonSchema = z.strictObject({
  source_key: SourceKeySchema,
  slug: SlugSchema,
  name: text(200),
  first_name: text(100).nullable(),
  middle_name: text(100).nullable(),
  last_name: text(100).nullable(),
  suffix: text(20).nullable(),
  party: PartySchema.nullable(),
  photo: PhotoRecordSchema.nullable(),
  website: SafeUrlSchema.nullable(),
  roster_only: z.boolean(),
  origin: z.strictObject({
    created_by: z.literal('bundle'),
    key: SourceKeySchema,
    datasets: z.array(text(60)).min(1).max(10),
  }),
});
export type BPerson = z.infer<typeof BPersonSchema>;

export const BPersonAliasSchema = z.strictObject({
  source_key: SourceKeySchema,
  person_key: SourceKeySchema,
  alias: text(200),
});
export type BPersonAlias = z.infer<typeof BPersonAliasSchema>;

export const BOfficeholderSchema = z.strictObject({
  source_key: SourceKeySchema,
  office_key: SlugSchema,
  person_key: SourceKeySchema,
  seat_label: text(100).nullable(),
  since: IsoDateSchema.nullable(),
  until: IsoDateSchema.nullable(),
  seat_up_next: z.boolean().nullable(),
  term_limited: z.boolean().nullable(),
  not_running: z.boolean().nullable(),
  cash_on_hand_cents: z.int().min(0).nullable(),
  cash_as_of: IsoDateSchema.nullable(),
  cash_source_url: SafeUrlSchema.nullable(),
});
export type BOfficeholder = z.infer<typeof BOfficeholderSchema>;

export const BGivenNameAliasSchema = z.strictObject({
  source_key: SourceKeySchema,
  canonical: z.string().regex(/^[a-z][a-z' -]{0,40}$/),
  alias: z.string().regex(/^[a-z][a-z' -]{0,40}$/),
  source: z.enum(['nicknames', 'supplement']), // 'admin' rows are written only by the admin tool
});
export type BGivenNameAlias = z.infer<typeof BGivenNameAliasSchema>;
