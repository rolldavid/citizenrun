// The stage-internal file `office_refs.ndjson.gz`: one row per office, written beside its `offices`
// file by every stage that creates offices. It carries the office identity (PIPE-slugs) and the
// inputs of the rules' OfficeRef. It is never a bundle file.
import type { OfficeRef } from '@citizenrun/rules';
import { PartySchema, RefIdSchema, SlugSchema, SourceKeySchema } from '@citizenrun/shared';
import { z } from 'zod';
import { StaggerGroupSchema } from '../../templates/schema.ts';

export const OfficeRefRowSchema = z.strictObject({
  slug: SlugSchema,
  identity: z.string().min(1).max(700), // PIPE-slugs office identity
  origin: z.enum(['s02-known', 's02-coops', 's04-expand']),
  template_key: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .nullable(), // the template office key; null for a stage-2 office with no template entry
  office_type_id: RefIdSchema,
  jurisdiction_key: SourceKeySchema,
  jurisdiction_kind: z.enum([
    'state',
    'county',
    'city',
    'township',
    'school_district',
    'special_district',
    'coop',
    'party',
  ]),
  district_key: SourceKeySchema,
  county_geoid: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
  party: PartySchema.nullable(), // party committee offices only
  party_selection: z.enum(['primary_ballot', 'caucus', 'party_meeting']).nullable(),
  partisan: z.boolean().nullable(),
  schedule: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .nullable(), // null: no election is generated
  track_set: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .nullable(),
  stagger: z.array(StaggerGroupSchema).max(6), // the groups this office's seats belong to; [] when every seat is elected together
  stagger_group: z
    .string()
    .regex(/^[A-Z]$/)
    .nullable(), // the group passed to the rules as OfficeRef.staggerGroup
  seats: z.int().min(1).max(200),
  body_size: z.int().min(1).max(500).nullable(),
  term_years: z.number().positive().max(15).nullable(),
  pay_annual_cents: z.int().min(0).nullable(),
  pay_range: z.strictObject({ min_cents: z.int().min(0), max_cents: z.int().min(0) }).nullable(),
  template_seats: z.int().min(1).nullable(), // a grounded template seat count, for the plausibility rule on seat counts
  population: z.int().min(0).nullable(),
});
export type OfficeRefRow = z.infer<typeof OfficeRefRowSchema>;

/** The name given to `writeRows` for this file. */
export const OFFICE_REFS_FILE = 'office_refs';

/** An office with no schedule or track set, which the rules are never asked about. */
export class OfficeRefUnscheduled extends Error {
  override readonly name = 'OfficeRefUnscheduled';

  constructor() {
    super('an office with no schedule or track set has no rules reference');
  }
}

/**
 * The rules' OfficeRef of an office row; `templateKey` is the template key, else the office type.
 * Throws OfficeRefUnscheduled when the row has no schedule or no track set.
 */
export function toRulesOfficeRef(row: OfficeRefRow, state: string): OfficeRef {
  if (row.schedule === null || row.track_set === null) {
    throw new OfficeRefUnscheduled();
  }
  return {
    state,
    templateKey: row.template_key ?? row.office_type_id,
    officeTypeId: row.office_type_id,
    jurisdictionKind: row.jurisdiction_kind,
    countyGeoid: row.county_geoid,
    partisan: row.partisan,
    schedule: row.schedule,
    trackSet: row.track_set,
    staggerGroup: row.stagger_group,
    termYears: row.term_years,
    payAnnualCents: row.pay_annual_cents,
    population: row.population,
  };
}
