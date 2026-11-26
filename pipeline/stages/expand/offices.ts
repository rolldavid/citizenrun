// The offices of one template entry or one unit (PIPE-expand steps 2 and 3): seats by arrangement,
// titles, cited facts with their proof, pay, powers, and the placeholder of a unit the template
// cannot place (D-321).
import { kebab } from '@citizenrun/shared';
import type { BOffice, BOfficePower, FieldMetaRow } from '@citizenrun/shared';
import type { StateRules } from '@citizenrun/rules';
import { resolve } from '../../lib/confidence.ts';
import { officeIdentity } from '../../lib/slug.ts';
import type { CitedNode } from '../../templates/cited.ts';
import { citedConfidence, citedMeta } from '../../templates/output.ts';
import type { TemplateOutput } from '../../templates/output.ts';
import type { OfficeEntry, StateTemplate } from '../../templates/schema.ts';
import { fillLabel, fillTitle } from '../../templates/title.ts';
import { computedEvidence } from '../shared/evidence.ts';
import { toRulesOfficeRef } from '../shared/office-ref.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import type { RelevanceDefaults } from '../shared/reference.ts';
import { matchUnit, patternMatches } from './match.ts';
import type { ExpandUnit, ExpandUnitKind } from './units.ts';

/** An office row before its slug is assigned. */
export type DraftOfficeRow = Omit<BOffice, 'source_key' | 'slug' | 'seats_up_next'>;
export type DraftPowerRow = Omit<BOfficePower, 'source_key' | 'office_key'>;
export type DraftRef = Omit<OfficeRefRow, 'slug'>;

export type DraftOffice = {
  readonly identity: string;
  /** The jurisdiction name the slug base is built from. */
  readonly jurisdictionName: string;
  readonly office: DraftOfficeRow;
  readonly powers: readonly DraftPowerRow[];
  readonly ref: DraftRef;
  /** `contests`: seats up next from the next electing contest; `none`: always null. */
  readonly seatsUpNext: 'contests' | 'none';
  /** An office of the template's statewide block (the turnout rule's `statewide`). */
  readonly statewide: boolean;
};

/** A `parent_fallback:<jurisdiction key>:<kebab label>` district a by-district office stands on. */
export type FallbackPlan = {
  readonly key: string;
  readonly jurisdictionKey: string;
  readonly name: string;
  readonly ownDistrictKey: string;
  readonly viaKeys: readonly string[];
};

/** Where an entry's offices are made. */
export type EntryTarget = {
  readonly jurisdictionKey: string;
  readonly jurisdictionName: string;
  readonly jurisdictionKind: OfficeRefRow['jurisdiction_kind'];
  readonly ownDistrictKey: string;
  readonly exactViaKeys: readonly string[];
  readonly placeGeoid: string | null;
  readonly countyGeoid: string | null;
  readonly population: number | null;
  /** A party committee's party and how its members are chosen, with that value's proof. */
  readonly party: {
    readonly key: string;
    readonly selection: NonNullable<OfficeRefRow['party_selection']>;
    readonly meta: FieldMetaRow;
  } | null;
  readonly statewide: boolean;
};

export type OfficeContext = {
  readonly out: TemplateOutput;
  readonly rules: StateRules | null;
  readonly state: string;
  readonly today: string;
  readonly now: Date;
  readonly relevanceDefaults: RelevanceDefaults;
  readonly newestRetrievedOn: string | null;
  /** Stage 1's district keys, for the ward lookup. */
  readonly districtKeys: ReadonlySet<string>;
  /** The population of each county union district this stage makes. */
  readonly unionPopulations: ReadonlyMap<string, number | null>;
};

export type EntryOffices = {
  readonly drafts: readonly DraftOffice[];
  readonly fallbacks: readonly FallbackPlan[];
  /** By-district offices of a staggered entry, whose groups the template cannot give. */
  readonly staggerUnmapped: number;
};

const PLACEHOLDER_TYPE: Readonly<Record<ExpandUnitKind, string>> = {
  county: 'county-commission',
  city: 'city-council',
  township: 'township-board',
  school_district: 'school-board',
  special_district: 'special-district-other',
};

/** The office columns no source of this stage fills. */
const EMPTY_COLUMNS = {
  vacant_seats_up_next: null,
  electorate: null,
  pay_change_note: null,
  hours_per_week: null,
  full_time: null,
  meeting_times: null,
  fits_day_job: null,
  filing_fee_cents: null,
  signatures_required: null,
  where_to_file: null,
  eligibility: null,
} as const;

type Pay = {
  readonly pay_kind: BOffice['pay_kind'];
  readonly pay_amount_cents: number | null;
  readonly pay_period: BOffice['pay_period'];
  readonly pay_annual_cents: number | null;
  readonly meta: Readonly<Record<string, FieldMetaRow>>;
};

const NO_PAY: Pay = {
  pay_kind: null,
  pay_amount_cents: null,
  pay_period: null,
  pay_annual_cents: null,
  meta: {},
};

const PAY_FIELDS = ['pay_kind', 'pay_amount_cents', 'pay_period', 'pay_annual_cents'] as const;

function annualCents(amount: number, period: 'year' | 'month' | 'meeting'): number | null {
  switch (period) {
    case 'year':
      return amount;
    case 'month':
      return amount * 12;
    case 'meeting':
      return null;
  }
}

/** True when the entry's `applies_to` holds for a unit of this name and population. */
export function appliesTo(
  entry: OfficeEntry,
  path: string,
  name: string,
  population: number | null,
): boolean {
  const narrow = entry.applies_to;
  if (narrow === null) {
    return true;
  }
  if (
    narrow.name_pattern !== null &&
    !patternMatches(narrow.name_pattern, name, `${path}.applies_to.name_pattern`)
  ) {
    return false;
  }
  if (narrow.population_min !== null || narrow.population_max !== null) {
    if (population === null) {
      return false;
    }
    if (narrow.population_min !== null && population < narrow.population_min) {
      return false;
    }
    if (narrow.population_max !== null && population > narrow.population_max) {
      return false;
    }
  }
  return true;
}

function explicitPay(ctx: OfficeContext, entry: OfficeEntry, path: string): Pay | 'county_pay' {
  const pay = entry.pay;
  if (pay === null || 'local' in pay) {
    return NO_PAY;
  }
  if ('rule' in pay) {
    return 'county_pay';
  }
  const meta = citedMeta(ctx.out, `${path}.pay`, pay);
  return {
    pay_kind: pay.kind,
    pay_amount_cents: pay.amount_cents,
    pay_period: pay.period,
    pay_annual_cents: annualCents(pay.amount_cents, pay.period),
    meta: Object.fromEntries(PAY_FIELDS.map((field) => [field, meta])),
  };
}

/** Statutory county pay from the rules (D-317), with proof resolved from the citation. */
function countyPay(ctx: OfficeContext, template: StateTemplate, ref: DraftRef): Pay {
  if (
    ctx.rules === null ||
    (template.county_pay !== 'statute' && template.county_pay !== 'mixed')
  ) {
    return NO_PAY;
  }
  // The slug is not part of the rules' office reference.
  const office = toRulesOfficeRef({ ...ref, slug: '' }, ctx.state);
  const computed = ctx.rules.countyPay({ office, year: Number(ctx.today.slice(0, 4)) });
  if (computed === null) {
    return NO_PAY;
  }
  const values: Record<(typeof PAY_FIELDS)[number], unknown> = {
    pay_kind: 'salary',
    pay_amount_cents: computed.value.amountCents,
    pay_period: computed.value.period,
    pay_annual_cents: annualCents(computed.value.amountCents, computed.value.period),
  };
  const meta: Record<string, FieldMetaRow> = {};
  const resolved: Record<string, unknown> = {};
  for (const field of PAY_FIELDS) {
    const evidence = computedEvidence(
      values[field],
      computed.citation,
      ctx.newestRetrievedOn,
      ctx.now,
    );
    const result = resolve(field, [evidence], ctx.now);
    if (result.value === null || result.meta === null) {
      return NO_PAY;
    }
    resolved[field] = result.value;
    meta[field] = result.meta;
  }
  return {
    pay_kind: resolved['pay_kind'] as Pay['pay_kind'],
    pay_amount_cents: resolved['pay_amount_cents'] as number,
    pay_period: resolved['pay_period'] as Pay['pay_period'],
    pay_annual_cents: resolved['pay_annual_cents'] as number | null,
    meta,
  };
}

function powerRows(ctx: OfficeContext, entry: OfficeEntry, path: string): DraftPowerRow[] {
  const seen = new Set<string>();
  const rows: DraftPowerRow[] = [];
  if (entry.powers.length > 0) {
    entry.powers.forEach((power, j) => {
      if (seen.has(power.power)) {
        return;
      }
      seen.add(power.power);
      const at = `${path}.powers.${String(j)}`;
      rows.push({
        power_id: power.power,
        relevance: power.relevance,
        quote: power.quote,
        source_url: power.source_url,
        confidence: citedConfidence(ctx.out, at),
        checked_at: ctx.out.grounded[at]?.checked_at ?? null,
      });
    });
    return rows;
  }
  // The national defaults, at low with no proof (D-319).
  for (const [power, relevance] of ctx.relevanceDefaults.get(entry.office_type) ?? []) {
    rows.push({
      power_id: power,
      relevance,
      quote: null,
      source_url: null,
      confidence: 'low',
      checked_at: null,
    });
  }
  return rows;
}

function isGrounded(ctx: OfficeContext, path: string): boolean {
  return citedConfidence(ctx.out, path) === 'medium';
}

/**
 * The offices one entry gives a target: one at-large office, one office per district label, or
 * both (`mixed`). A party committee's entries are always at large.
 */
export function entryOffices(
  template: StateTemplate,
  entry: OfficeEntry,
  path: string,
  target: EntryTarget,
  ctx: OfficeContext,
  opts: { readonly atLargeOnly?: boolean } = {},
): EntryOffices {
  const facts: Record<string, FieldMetaRow> = {};
  const cite = (field: string, node: CitedNode | null) => {
    if (node !== null) {
      facts[field] = citedMeta(ctx.out, `${path}.${field}`, node);
    }
  };
  cite('body_size', entry.body_size);
  cite('term_years', entry.term_years);
  cite('term_limit_terms', entry.term_limit_terms);
  cite('partisan', entry.partisan);
  cite('benefits', entry.benefits);
  if (target.party !== null) {
    facts['party_selection'] = target.party.meta;
  }
  const pay = explicitPay(ctx, entry, path);
  const powers = powerRows(ctx, entry, path);

  const union =
    entry.district === null ? null : `county_union:${ctx.state}:${entry.district.county_union}`;
  const ownDistrictKey = union ?? target.ownDistrictKey;
  const exactViaKeys = union === null ? target.exactViaKeys : [union];
  const population = union === null ? target.population : (ctx.unionPopulations.get(union) ?? null);

  const drafts: DraftOffice[] = [];
  const fallbacks: FallbackPlan[] = [];
  let staggerUnmapped = 0;

  const make = (variant: {
    readonly districtKey: string;
    readonly title: string;
    readonly seats: number;
    readonly seatsMeta: FieldMetaRow | null;
    readonly stagger: OfficeRefRow['stagger'];
    readonly templateSeats: number | null;
    readonly seatsUpNext: DraftOffice['seatsUpNext'];
  }) => {
    const identity = officeIdentity(target.jurisdictionKey, entry.key, variant.districtKey);
    const ref: DraftRef = {
      identity,
      origin: 's04-expand',
      template_key: entry.key,
      office_type_id: entry.office_type,
      jurisdiction_key: target.jurisdictionKey,
      jurisdiction_kind: target.jurisdictionKind,
      district_key: variant.districtKey,
      county_geoid: target.countyGeoid,
      party: target.party?.key ?? null,
      party_selection: target.party?.selection ?? null,
      partisan: entry.partisan?.value ?? null,
      schedule: entry.schedule,
      track_set: entry.track_set,
      stagger: variant.stagger,
      stagger_group: null,
      seats: variant.seats,
      body_size: entry.body_size?.value ?? null,
      term_years: entry.term_years?.value ?? null,
      pay_annual_cents: null,
      pay_range:
        entry.pay_range === null
          ? null
          : { min_cents: entry.pay_range.min_cents, max_cents: entry.pay_range.max_cents },
      template_seats: variant.templateSeats,
      population,
    };
    const officePay = pay === 'county_pay' ? countyPay(ctx, template, ref) : pay;
    const fieldMeta: Record<string, FieldMetaRow> = { ...facts, ...officePay.meta };
    if (variant.seatsMeta !== null) {
      fieldMeta['seats'] = variant.seatsMeta;
    }
    drafts.push({
      identity,
      jurisdictionName: target.jurisdictionName,
      office: {
        jurisdiction_key: target.jurisdictionKey,
        district_key: variant.districtKey,
        office_type_id: entry.office_type,
        title: variant.title,
        placeholder: false,
        seats: variant.seats,
        body_size: ref.body_size,
        term_years: ref.term_years,
        term_limit_terms: entry.term_limit_terms?.value ?? null,
        partisan: ref.partisan,
        party_selection: ref.party_selection,
        pay_annual_cents: officePay.pay_annual_cents,
        pay_kind: officePay.pay_kind,
        pay_amount_cents: officePay.pay_amount_cents,
        pay_period: officePay.pay_period,
        benefits: entry.benefits?.value ?? null,
        ...EMPTY_COLUMNS,
        field_meta: fieldMeta,
      },
      powers,
      ref: { ...ref, pay_annual_cents: officePay.pay_annual_cents },
      seatsUpNext: variant.seatsUpNext,
      statewide: target.statewide,
    });
  };

  const arrangement = opts.atLargeOnly === true ? 'at_large' : entry.seats.arrangement;
  if (arrangement === 'at_large' || arrangement === 'mixed') {
    const count = entry.seats.count;
    make({
      districtKey: ownDistrictKey,
      title: fillTitle(entry.title, { jurisdiction: target.jurisdictionName }),
      seats: count?.value ?? 1,
      seatsMeta: count === null ? null : citedMeta(ctx.out, `${path}.seats.count`, count),
      stagger: entry.stagger,
      templateSeats: count !== null && isGrounded(ctx, `${path}.seats.count`) ? count.value : null,
      seatsUpNext: 'contests',
    });
  }
  const districtCount = entry.seats.district_count;
  const labelPattern = entry.seats.label_pattern;
  if (
    (arrangement === 'by_district' || arrangement === 'mixed') &&
    districtCount !== null &&
    labelPattern !== null
  ) {
    const seatsMeta = citedMeta(ctx.out, `${path}.seats.district_count`, districtCount);
    const grounded = isGrounded(ctx, `${path}.seats.district_count`);
    const staggered = entry.stagger.length > 0;
    for (let n = 1; n <= districtCount.value; n += 1) {
      const label = fillLabel(labelPattern, n);
      const labelKey = kebab(label);
      const ward = target.placeGeoid === null ? null : `ward:${target.placeGeoid}:${labelKey}`;
      let districtKey: string;
      if (ward !== null && union === null && ctx.districtKeys.has(ward)) {
        districtKey = ward;
      } else {
        districtKey = `parent_fallback:${target.jurisdictionKey}:${labelKey}`;
        fallbacks.push({
          key: districtKey,
          jurisdictionKey: target.jurisdictionKey,
          name: `${target.jurisdictionName} ${label}`,
          ownDistrictKey,
          viaKeys: exactViaKeys,
        });
      }
      if (staggered) {
        staggerUnmapped += 1;
      }
      make({
        districtKey,
        title: fillTitle(entry.title, { jurisdiction: target.jurisdictionName, label }),
        seats: 1,
        seatsMeta,
        stagger: [],
        templateSeats: grounded ? 1 : null,
        seatsUpNext: staggered ? 'none' : 'contests',
      });
    }
  }
  return { drafts, fallbacks, staggerUnmapped };
}

/** One placeholder office for a unit the template cannot place (D-321). */
export function placeholderOffice(unit: ExpandUnit): DraftOffice {
  const officeType = PLACEHOLDER_TYPE[unit.kind];
  const identity = officeIdentity(unit.key, 'placeholder', unit.ownDistrictKey);
  return {
    identity,
    jurisdictionName: unit.name,
    office: {
      jurisdiction_key: unit.key,
      district_key: unit.ownDistrictKey,
      office_type_id: officeType,
      title: unit.name,
      placeholder: true,
      seats: 1,
      body_size: null,
      term_years: null,
      term_limit_terms: null,
      partisan: null,
      party_selection: null,
      pay_annual_cents: null,
      pay_kind: null,
      pay_amount_cents: null,
      pay_period: null,
      benefits: null,
      ...EMPTY_COLUMNS,
      field_meta: {},
    },
    powers: [],
    ref: {
      identity,
      origin: 's04-expand',
      template_key: null,
      office_type_id: officeType,
      jurisdiction_key: unit.key,
      jurisdiction_kind: unit.kind,
      district_key: unit.ownDistrictKey,
      county_geoid: unit.countyGeoid,
      party: null,
      party_selection: null,
      partisan: null,
      schedule: null,
      track_set: null,
      stagger: [],
      stagger_group: null,
      seats: 1,
      body_size: null,
      term_years: null,
      pay_annual_cents: null,
      pay_range: null,
      template_seats: null,
      population: unit.population,
    },
    seatsUpNext: 'none',
    statewide: false,
  };
}

export type UnitOffices = EntryOffices & {
  readonly outcome: 'offices' | 'placeholder' | 'not_elected' | 'inactive';
};

/**
 * The offices of one unit: none for an inactive unit or a body the template marks appointed; the
 * applicable entries of its government type or special-district block; else one placeholder.
 */
export function unitOffices(
  unit: ExpandUnit,
  template: StateTemplate,
  ctx: OfficeContext,
): UnitOffices {
  const none = { drafts: [], fallbacks: [], staggerUnmapped: 0 };
  if (unit.censusActive === false) {
    return { ...none, outcome: 'inactive' };
  }
  const placeholder = (): UnitOffices => ({
    drafts: [placeholderOffice(unit)],
    fallbacks: [],
    staggerUnmapped: 0,
    outcome: 'placeholder',
  });
  const match = matchUnit(unit, template);
  let owner: { readonly elected: boolean; readonly offices: readonly OfficeEntry[] };
  let prefix: string;
  switch (match.kind) {
    case 'none':
      return placeholder();
    case 'government_type': {
      const type = template.government_types[match.index];
      if (type === undefined) {
        return placeholder();
      }
      owner = { elected: type.elected.value, offices: type.offices };
      prefix = `government_types.${String(match.index)}.offices`;
      break;
    }
    case 'special_district': {
      const block = template.special_districts[match.index];
      if (block === undefined) {
        return placeholder();
      }
      owner = { elected: block.elected.value, offices: block.offices };
      prefix = `special_districts.${String(match.index)}.offices`;
      break;
    }
  }
  if (!owner.elected) {
    return { ...none, outcome: 'not_elected' };
  }
  const target: EntryTarget = {
    jurisdictionKey: unit.key,
    jurisdictionName: unit.name,
    jurisdictionKind: unit.kind,
    ownDistrictKey: unit.ownDistrictKey,
    exactViaKeys: unit.exactViaKeys,
    placeGeoid: unit.placeGeoid,
    countyGeoid: unit.countyGeoid,
    population: unit.population,
    party: null,
    statewide: false,
  };
  const drafts: DraftOffice[] = [];
  const fallbacks: FallbackPlan[] = [];
  let staggerUnmapped = 0;
  owner.offices.forEach((entry, j) => {
    const path = `${prefix}.${String(j)}`;
    if (!appliesTo(entry, path, unit.name, unit.population)) {
      return;
    }
    const made = entryOffices(template, entry, path, target, ctx);
    drafts.push(...made.drafts);
    fallbacks.push(...made.fallbacks);
    staggerUnmapped += made.staggerUnmapped;
  });
  if (drafts.length === 0) {
    return placeholder();
  }
  return { drafts, fallbacks, staggerUnmapped, outcome: 'offices' };
}
