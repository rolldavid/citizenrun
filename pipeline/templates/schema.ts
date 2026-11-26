// PIPE-template-schema: the shape of data/templates/<st>.yaml. Frozen once released; later changes
// are additive.
import { PartySchema, RefIdSchema, SafeUrlSchema, text } from '@citizenrun/shared';
import { z } from 'zod';

export const TEMPLATE_SCHEMA_VERSION = 1;

/** A fact taken from a statute, constitution, charter or official page, with its proof. */
export const cited = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    value,
    source_url: SafeUrlSchema,
    quote: text(2000), // exact text; grounded by PIPE-templates step 3
    citation: text(300), // 'RCW 29A.24.050'
  });

export const TemplateEligibilitySchema = z.strictObject({
  kind: z.enum([
    'min_age',
    'residency',
    'registered_voter',
    'party_member',
    'outside_employment_ban',
    'resign_to_run',
    'other',
  ]),
  value: text(300), // '18', 'resident of the district for 1 year', ...
  source_url: SafeUrlSchema,
  quote: text(2000),
  citation: text(300),
});

export const PowerEntrySchema = z.strictObject({
  power: RefIdSchema,
  relevance: z.int().min(1).max(3),
  source_url: SafeUrlSchema,
  quote: text(2000),
  citation: text(300),
});

export const PayEntrySchema = z.union([
  z.strictObject({
    kind: z.enum(['salary', 'stipend', 'per_meeting', 'none']),
    amount_cents: z.int().min(0),
    period: z.enum(['year', 'month', 'meeting']),
    source_url: SafeUrlSchema,
    quote: text(2000),
    citation: text(300),
  }),
  z.strictObject({ rule: z.literal('county_pay') }), // computed by rules.countyPay (D-317)
  z.strictObject({ local: z.literal(true) }), // set by each body; left to the crawl
]);

export const StaggerGroupSchema = z.strictObject({
  group: z.string().regex(/^[A-Z]$/),
  seats: z.int().min(1),
  every: z.int().min(1).max(12), // elected in years y with (y - first) mod every = 0
  first: z.int().min(1990).max(2100),
});

export const OfficeEntrySchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), // unique in the state; part of the office identity (PIPE-slugs)
  office_type: RefIdSchema,
  applies_to: z
    .strictObject({
      // optional narrowing inside a government type
      name_pattern: z.string().max(200).nullable(), // a regular expression on the jurisdiction name
      population_min: z.int().min(0).nullable(),
      population_max: z.int().min(0).nullable(),
    })
    .nullable(),
  title: text(200), // pattern: {jurisdiction}, {label}
  seats: z.strictObject({
    arrangement: z.enum(['at_large', 'by_district', 'mixed']),
    count: cited(z.int().min(1)).nullable(), // at-large seats
    district_count: cited(z.int().min(1)).nullable(), // by-district seats
    label_pattern: text(60).nullable(), // 'District {n}'
  }),
  body_size: cited(z.int().min(1)).nullable(),
  stagger: z.array(StaggerGroupSchema).max(6), // empty: every seat is elected together; a by_district office carries no group (PIPE-expand step 10)
  term_years: cited(z.number().positive().max(15)).nullable(),
  term_limit_terms: cited(z.int().min(1)).nullable(),
  schedule: z.string().regex(/^[a-z0-9_]+$/), // a schedule id the state's rules module exports
  track_set: z.string().regex(/^[a-z0-9_]+$/), // a track-set id the state's rules module exports
  partisan: cited(z.boolean()).nullable(),
  powers: z.array(PowerEntrySchema).max(20), // empty: the national defaults apply (D-319)
  pay: PayEntrySchema.nullable(), // null: not known yet
  pay_range: z
    .strictObject({
      min_cents: z.int().min(0),
      max_cents: z.int().min(0),
      source_url: SafeUrlSchema,
      quote: text(2000),
      citation: text(300),
    })
    .nullable(),
  benefits: cited(z.array(z.enum(['health', 'retirement', 'other']))).nullable(),
  eligibility: z.array(TemplateEligibilitySchema).max(20),
  job_restrictions: z.array(TemplateEligibilitySchema).max(10), // kinds outside_employment_ban, resign_to_run
  district: z.strictObject({ county_union: z.string().regex(/^[a-z0-9-]+$/) }).nullable(), // a county union (PIPE-geometry)
  wikidata_position: z
    .string()
    .regex(/^Q\d+$/)
    .nullable(), // statewide offices (D-315)
  roster_url: SafeUrlSchema.nullable(), // statewide offices: the agency's roster page (D-315)
});

export const GovernmentTypeSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(['county', 'city', 'township', 'school_district']),
  unit_type_codes: z.array(z.int().min(1).max(5)).nullable(), // narrows by the listing's UNIT_TYPE code
  school_levels: z.array(text(100)).nullable(), // narrows by SCHOOL_LEVEL_DESCRIPTION
  elected: cited(z.boolean()), // false: no offices and no placeholder
  offices: z.array(OfficeEntrySchema).max(40),
});

export const SpecialDistrictBlockSchema = z.strictObject({
  // D-321
  key: z.string().regex(/^[a-z0-9-]+$/),
  enabling_statute: cited(text(300)),
  elected: cited(z.boolean()),
  classifier: z.strictObject({
    function_names: z.array(text(120)).min(1), // listing FUNCTION_NAME values, e.g. '92 - Electric power utility'
    name_patterns: z.array(z.string().max(200)), // case-insensitive regular expressions; empty: function name alone
  }),
  offices: z.array(OfficeEntrySchema).max(5),
});

export const PartyCommitteeSchema = z.strictObject({
  // D-318
  selection: cited(z.enum(['primary_ballot', 'caucus', 'party_meeting', 'none'])),
  unit: z.enum(['precinct', 'ward', 'county', 'district']),
  seats_rule: cited(text(300)), // 'one per precinct per party', 'one or more per precinct'
  term_years: cited(z.number().positive()).nullable(),
  parties: z.array(PartySchema).min(1),
  offices: z.array(OfficeEntrySchema).min(1).max(2), // party-precinct-committee and, where provided, party-committee
});

export const ChamberEntrySchema = z.strictObject({
  // state legislative chambers (PIPE-known-bodies)
  office_type: z.enum(['state-senate', 'state-house']),
  title: text(200), // pattern with {label} and, for positions, {position}
  seats_per_district: z
    .strictObject({
      // null: one seat per district
      count: cited(z.int().min(2).max(10)),
      arrangement: z.enum(['together', 'positions']), // elected together (one office) or as numbered positions (one office each)
      position_label_pattern: text(60).nullable(), // 'Position {n}' when arrangement is 'positions'
    })
    .nullable(),
  district_groups: z
    .array(
      z.strictObject({
        // staggered chambers: which districts are elected when
        group: z.string().regex(/^[A-Z]$/),
        districts: z.union([z.enum(['odd', 'even', 'all']), z.array(text(20)).min(1)]),
        every: z.int().min(1).max(12),
        first: z.int().min(1990).max(2100),
      }),
    )
    .min(1),
  term_years: cited(z.number().positive().max(15)).nullable(),
  term_limit_terms: cited(z.int().min(1)).nullable(),
  partisan: cited(z.boolean()).nullable(),
  pay: PayEntrySchema.nullable(),
  schedule: z.string().regex(/^[a-z0-9_]+$/),
  track_set: z.string().regex(/^[a-z0-9_]+$/),
  powers: z.array(PowerEntrySchema).max(20),
  eligibility: z.array(TemplateEligibilitySchema).max(20),
  job_restrictions: z.array(TemplateEligibilitySchema).max(10),
});

export const FederalEntrySchema = z.strictObject({
  // U.S. House and Senate contests in the state
  partisan: cited(z.boolean()).nullable(),
  schedule: z.string().regex(/^[a-z0-9_]+$/),
  track_set: z.string().regex(/^[a-z0-9_]+$/),
});

export const StateTemplateSchema = z.strictObject({
  schema_version: z.literal(1),
  state: z.string().regex(/^[A-Z]{2}$/),
  name: text(60),
  rules_module: z.string().regex(/^[a-z]{2}$/), // packages/rules/src/states/<st>.ts
  county_pay: z.enum(['statute', 'local', 'mixed']), // D-317
  calendar_pages: z.array(
    z.strictObject({
      url: SafeUrlSchema,
      scope: z.enum(['state', 'county', 'city', 'township', 'school_district', 'special_district']),
      notes: text(300).nullable(),
    }),
  ),
  parties_with_primaries: z.array(PartySchema), // empty for top-two, top-four and nonpartisan-only states
  government_types: z.array(GovernmentTypeSchema).min(1),
  statewide: z.array(OfficeEntrySchema), // D-315: the only source of statewide offices
  legislature: z.array(ChamberEntrySchema).min(1).max(2), // Nebraska: one chamber
  federal: z.strictObject({ us_house: FederalEntrySchema, us_senate: FederalEntrySchema }),
  county_sets: z.array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9-]+$/),
      name: text(120),
      counties: z.array(z.string().regex(/^\d{5}$/)).min(1), // a county GEOID
      source_url: SafeUrlSchema,
      quote: text(2000),
      citation: text(300),
    }),
  ),
  special_districts: z.array(SpecialDistrictBlockSchema),
  party_committee: PartyCommitteeSchema,
  eligibility_common: z.array(TemplateEligibilitySchema), // applies to every office unless an office entry overrides the same kind
  notes: text(2000).nullable(),
});

export type StateTemplate = z.infer<typeof StateTemplateSchema>;
export type OfficeEntry = z.infer<typeof OfficeEntrySchema>;
export type GovernmentType = z.infer<typeof GovernmentTypeSchema>;
export type SpecialDistrictBlock = z.infer<typeof SpecialDistrictBlockSchema>;
export type PartyCommittee = z.infer<typeof PartyCommitteeSchema>;
export type ChamberEntry = z.infer<typeof ChamberEntrySchema>;
export type FederalEntry = z.infer<typeof FederalEntrySchema>;
export type PayEntry = z.infer<typeof PayEntrySchema>;
export type StaggerGroup = z.infer<typeof StaggerGroupSchema>;
export type PowerEntry = z.infer<typeof PowerEntrySchema>;
export type TemplateEligibility = z.infer<typeof TemplateEligibilitySchema>;
