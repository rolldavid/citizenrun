// Stage 2, co-ops and public power (PIPE-coops, D-316): every retail electric cooperative as a
// `coop` jurisdiction with its county-approximate district, its Director office from its Form 990,
// its directors as roster-only people (O-14), and the website facts of matched public power
// districts. No AI.
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BGeometrySchema,
  BJurisdictionSchema,
  BOfficeholderSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BPersonSchema,
  SOURCE_URL_MAX,
  nameKey,
  officeSlugBase,
  parseName,
  parseSafeUrl,
  personSlug,
} from '@citizenrun/shared';
import type {
  BDistrict,
  BDistrictFallback,
  BGeometry,
  BJurisdiction,
  BOffice,
  BOfficePower,
  BOfficeholder,
  BPerson,
  FieldMetaMap,
  FieldMetaRow,
} from '@citizenrun/shared';
import { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import { loadCoopEinOverrides, loadCountyNameOverrides } from '../lib/data-files.ts';
import type { CoopEinOverride } from '../lib/data-files.ts';
import type { Fact } from '../lib/facts.ts';
import { readStageMeta, readStageRows } from '../lib/runner.ts';
import type { RunContext, StageModule, StageOptions, StageResult } from '../lib/runner.ts';
import { assignSlugs, loadSlugRegistry, officeIdentity } from '../lib/slug.ts';
import { PIPELINE_STATES } from '../lib/states.ts';
import { loadTimezoneRegister, zoneForCoop } from '../lib/timezones.ts';
import { LISTING_EDITION, readParsedListing } from '../sources/census-gus.ts';
import type { ParsedListingRow } from '../sources/census-gus.ts';
import {
  DatasetFileMissingError,
  DatasetUnavailableError,
  datasetEntry,
} from '../sources/dataset.ts';
import {
  EIA_DATASET,
  EIA_EDITION,
  EIA_URL,
  EiaHeaderError,
  customersReadable,
  eiaColumnSources,
  eiaTerritory,
  eiaUtilities,
  loadEia861,
  resolveCounties,
  retailCustomers,
} from '../sources/eia861.ts';
import type { CountyAttributes, EiaUtility } from '../sources/eia861.ts';
import {
  EOBMF_DATASET,
  EOBMF_EDITION,
  EoHeaderError,
  loadEoBmf,
  normaliseOrgName,
} from '../sources/irs-eobmf.ts';
import type { EoRow } from '../sources/irs-eobmf.ts';
import {
  IRS990_DATASET,
  IrsIndexHeaderError,
  fetchReturns,
  latestReturns,
  loadIndex,
  parseCoopReturn,
  returnSourceUrl,
} from '../sources/irs990.ts';
import type { CoopBoard, IndexRow, IndexYear } from '../sources/irs990.ts';
import { TIGER_LAYERS, ensureLayerFile, readDbf } from '../sources/tiger.ts';
import { titleCaseUnitName } from './base/listing.ts';
import { fallbackRow } from './shared/geometry-rows.ts';
import { OFFICE_REFS_FILE, OfficeRefRowSchema } from './shared/office-ref.ts';
import type { OfficeRefRow } from './shared/office-ref.ts';
import { loadRelevanceDefaults } from './shared/reference.ts';
import type { RelevanceDefaults } from './shared/reference.ts';
import { repoRoot } from './shared/repo.ts';
import { listStageStates } from './shared/stage-io.ts';
import { datasetEvidence } from './shared/evidence.ts';
import { fallbackGeomHash } from './base/geometry.ts';

export const S02_COOPS_BLOCKING_CHECKS = [
  'eia_header',
  'eobmf_header',
  'irs_index_header',
  'dataset_unavailable',
] as const;

const OFFICE_TYPE = 'coop-board';
const OFFICE_TITLE = 'Director';
const PUBLIC_POWER_FUNCTION = '92 - Electric power utility';
const PERSON_DATASETS = ['irs990', 'irs-eobmf'];
const MAX_HOURS = 80;
const MAX_SEATS = 200;

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// ---------------------------------------------------------------------------------------------
// Shapes

/** A matched return of a co-op's EIN, parsed. */
export type CoopReturn = {
  readonly ein: string;
  readonly objectId: string;
  readonly batch: string;
  readonly year: IndexYear;
  readonly retrievedAt: string;
  readonly board: CoopBoard | 'not_990';
};

export type CoopMatch =
  | { readonly kind: 'return'; readonly ret: CoopReturn }
  | {
      readonly kind: 'unmatched';
      readonly reason: 'ein_unmatched' | 'ein_ambiguous' | 'no_return' | 'batch_unavailable';
    };

/** One co-op of the state: its EIA row, its resolved served counties and what its EIN gave. */
export type CoopFacts = {
  readonly utilityNumber: string;
  readonly name: string;
  readonly counties: readonly string[];
  readonly customers: number | null;
  readonly match: CoopMatch;
};

export type ServedCounty = {
  readonly districtKey: string;
  readonly population: number | null;
  readonly timezone: string | null;
  readonly geometry: BGeometry | null;
};

export type PublicPowerMatch = {
  readonly jurisdictionKey: string;
  readonly utilityNumber: string;
  readonly name: string;
  readonly website: string | null;
};

export type CoopsInput = {
  readonly state: string;
  readonly today: string;
  readonly now: Date;
  /** Co-ops whose assigned state is `state`. */
  readonly coops: readonly CoopFacts[];
  /** Every served county by GEOID, from stage 1 of each served state. */
  readonly counties: ReadonlyMap<string, ServedCounty>;
  readonly publicPower: readonly PublicPowerMatch[];
  readonly relevanceDefaults: RelevanceDefaults;
  readonly assignSlugs: (
    requests: readonly { identity: string; base: string }[],
  ) => ReadonlyMap<string, string>;
  /** PIPE-geometry step 9 over the via rows. */
  readonly fallbackRow: (districtKey: string, via: readonly BGeometry[]) => Promise<BGeometry>;
  readonly zoneForCoop: (
    state: string,
    served: readonly { geoid: string; population: number | null }[],
  ) => string | null;
};

export type CoopsOutput = {
  readonly jurisdictions: readonly BJurisdiction[];
  readonly districts: readonly BDistrict[];
  readonly districtFallbacks: readonly BDistrictFallback[];
  readonly geometry: readonly BGeometry[];
  readonly offices: readonly BOffice[];
  readonly officePowers: readonly BOfficePower[];
  readonly people: readonly BPerson[];
  readonly officeholders: readonly BOfficeholder[];
  readonly officeRefs: readonly OfficeRefRow[];
  readonly facts: readonly Fact[];
  readonly counts: Readonly<Record<string, number>>;
};

// ---------------------------------------------------------------------------------------------
// Selection, state assignment, EIN and public power matching (pure)

/** Co-ops (step 1): ownership `cooperative` and at least one service-territory row. */
export function selectCoops(
  utilities: readonly EiaUtility[],
  territoryUtilities: ReadonlySet<string>,
): readonly EiaUtility[] {
  return utilities.filter(
    (u) => u.ownership === 'cooperative' && territoryUtilities.has(u.utilityNumber),
  );
}

/**
 * The state with the most resolved served counties (ties: alphabetical); a co-op with no resolved
 * county takes the state of its utility row.
 */
export function assignState(
  utility: Pick<EiaUtility, 'state'>,
  counties: readonly string[],
  stateOfFips: ReadonlyMap<string, string>,
): string {
  const tally = new Map<string, number>();
  for (const geoid of counties) {
    const state = stateOfFips.get(geoid.slice(0, 2));
    if (state !== undefined) tally.set(state, (tally.get(state) ?? 0) + 1);
  }
  let best: { state: string; n: number } | null = null;
  for (const [state, n] of tally) {
    if (best === null || n > best.n || (n === best.n && state < best.state)) best = { state, n };
  }
  return best?.state ?? utility.state;
}

/** The EO BMF rows with `SUBSECTION = 12` whose normalised name equals the co-op's. */
export function einCandidates(
  utility: Pick<EiaUtility, 'name'>,
  rows: readonly EoRow[],
): readonly EoRow[] {
  const wanted = normaliseOrgName(utility.name);
  return rows.filter((row) => row.subsection === '12' && normaliseOrgName(row.name) === wanted);
}

/** The lower-case host of a written website (`www.example.org`, `https://example.org/x`), or null. */
export function websiteHost(text: string | null): string | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase().replace(/\.$/u, '') || null;
  } catch {
    return null;
  }
}

function cityAgrees(eo: string, eia: string | null): boolean {
  return eia !== null && eo.trim().toLowerCase() === eia.trim().toLowerCase();
}

/**
 * The co-op's EIN (steps 2 and 3): the override entry wins (`none`: unmatched); otherwise exactly
 * one candidate accepted, a candidate being accepted when its city equals EIA's city or its
 * return's website host equals EIA's website host.
 */
export function matchEin(input: {
  readonly utility: Pick<EiaUtility, 'city' | 'website'>;
  readonly candidates: readonly EoRow[];
  readonly override: CoopEinOverride | undefined;
  readonly websiteOf: (ein: string) => string | null;
}):
  { kind: 'ein'; ein: string } | { kind: 'unmatched'; reason: 'ein_unmatched' | 'ein_ambiguous' } {
  if (input.override !== undefined) {
    return input.override.ein === 'none'
      ? { kind: 'unmatched', reason: 'ein_unmatched' }
      : { kind: 'ein', ein: input.override.ein };
  }
  const host = websiteHost(input.utility.website);
  const accepted = new Set<string>();
  for (const row of input.candidates) {
    const byCity = cityAgrees(row.city, input.utility.city);
    const byWebsite = host !== null && websiteHost(input.websiteOf(row.ein)) === host;
    if (byCity || byWebsite) accepted.add(row.ein);
  }
  const [only, ...rest] = [...accepted];
  if (only === undefined) return { kind: 'unmatched', reason: 'ein_unmatched' };
  if (rest.length > 0) return { kind: 'unmatched', reason: 'ein_ambiguous' };
  return { kind: 'ein', ein: only };
}

/** The EINs whose returns the match may need: an override's, or a candidate the city accepts or a website may. */
export function wantedEins(input: {
  readonly utility: Pick<EiaUtility, 'city' | 'website'>;
  readonly candidates: readonly EoRow[];
  readonly override: CoopEinOverride | undefined;
}): readonly string[] {
  if (input.override !== undefined) {
    return input.override.ein === 'none' ? [] : [input.override.ein];
  }
  const withWebsite = websiteHost(input.utility.website) !== null;
  return input.candidates
    .filter((row) => withWebsite || cityAgrees(row.city, input.utility.city))
    .map((row) => row.ein);
}

/**
 * Public power (step 7): each `political_subdivision` utility of the state against the listing's
 * special districts of the state whose function is electric power, by normalised name. Only a
 * single match is kept.
 */
export function matchPublicPower(
  utilities: readonly EiaUtility[],
  listing: readonly Pick<
    ParsedListingRow,
    'pid6' | 'unit_name' | 'tab' | 'function_name' | 'fips_state'
  >[],
  state: string,
  fips: string,
): { matches: readonly PublicPowerMatch[]; matched: number; missed: number; ambiguous: number } {
  const units = new Map<string, string[]>();
  for (const row of listing) {
    if (
      row.tab !== 'Special District' ||
      row.function_name !== PUBLIC_POWER_FUNCTION ||
      row.fips_state !== fips
    ) {
      continue;
    }
    const key = normaliseOrgName(row.unit_name);
    units.set(key, [...(units.get(key) ?? []), row.pid6]);
  }
  const matches: PublicPowerMatch[] = [];
  let missed = 0;
  let ambiguous = 0;
  for (const u of utilities) {
    if (u.ownership !== 'political_subdivision' || u.state !== state) continue;
    const found = [...new Set(units.get(normaliseOrgName(u.name)) ?? [])];
    if (found.length === 0) missed += 1;
    else if (found.length > 1) ambiguous += 1;
    else {
      matches.push({
        jurisdictionKey: `census:${found[0] ?? ''}`,
        utilityNumber: u.utilityNumber,
        name: u.name,
        website: u.website,
      });
    }
  }
  return { matches, matched: matches.length, missed, ambiguous };
}

// ---------------------------------------------------------------------------------------------
// The pure core

function middle<T>(sorted: readonly T[]): readonly T[] {
  const n = sorted.length;
  if (n === 0) return [];
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? [sorted[mid] as T] : [sorted[mid - 1] as T, sorted[mid] as T];
}

type Director = CoopBoard['directors'][number];

/** The median of the directors' `(comp + other) × 100`, in whole cents, and the middle directors. */
export function medianPay(
  directors: readonly Director[],
): { cents: number; middle: readonly Director[] } | null {
  const paid = directors
    .map((d, index) => ({
      d,
      index,
      cents: d.comp === null || d.other === null ? null : (d.comp + d.other) * 100,
    }))
    .filter((p): p is { d: Director; index: number; cents: number } => p.cents !== null)
    .sort((a, b) => a.cents - b.cents || a.index - b.index);
  const mid = middle(paid);
  if (mid.length === 0) return null;
  const cents = Math.round(mid.reduce((sum, p) => sum + p.cents, 0) / mid.length);
  return { cents, middle: mid.map((p) => p.d) };
}

/** The median of the directors' hours (directors without hours left out) and the middle ones. */
export function medianHours(
  directors: readonly Director[],
): { hours: number; middle: readonly Director[] } | null {
  const timed = directors
    .map((d, index) => ({ d, index, hours: d.hours }))
    .filter((p): p is { d: Director; index: number; hours: number } => p.hours !== null)
    .sort((a, b) => a.hours - b.hours || a.index - b.index);
  const mid = middle(timed);
  if (mid.length === 0) return null;
  return {
    hours: mid.reduce((sum, p) => sum + p.hours, 0) / mid.length,
    middle: mid.map((p) => p.d),
  };
}

function meta(sourceUrl: string, quote: string | null, checkedAt: string): FieldMetaRow {
  return quote === null || quote === ''
    ? { source_url: sourceUrl, quote: null, confidence: 'low', checked_at: checkedAt }
    : { source_url: sourceUrl, quote, confidence: 'medium', checked_at: checkedAt };
}

class Counts {
  private readonly values = new Map<string, number>();
  add(name: string, n = 1): void {
    this.values.set(name, (this.values.get(name) ?? 0) + n);
  }
  record(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of [...this.values.keys()].sort()) out[name] = this.values.get(name) ?? 0;
    return out;
  }
}

const COUNT_NAMES = [
  'coops',
  'matched',
  'ein_unmatched',
  'ein_ambiguous',
  'no_return',
  'batch_unavailable',
  'board_not_member_elected',
  'not_990',
  'not_501c12',
  'coop_no_county',
  'county_without_base',
  'director_unnamed',
  'slug_unassigned',
];

type Board = {
  readonly ret: CoopReturn;
  readonly board: CoopBoard;
};

function officeRow(input: {
  slug: string;
  jurisdictionKey: string;
  districtKey: string;
  seats: number;
  bodySize: number | null;
  electorate: number | null;
  pay: number | null;
  hours: number | null;
  fieldMeta: FieldMetaMap;
}): BOffice {
  return BOfficeSchema.parse({
    source_key: input.slug,
    slug: input.slug,
    jurisdiction_key: input.jurisdictionKey,
    district_key: input.districtKey,
    office_type_id: OFFICE_TYPE,
    title: OFFICE_TITLE,
    placeholder: false,
    seats: input.seats,
    body_size: input.bodySize,
    seats_up_next: null,
    vacant_seats_up_next: null,
    term_years: null,
    term_limit_terms: null,
    partisan: false,
    party_selection: null,
    electorate: input.electorate,
    pay_annual_cents: input.pay,
    pay_kind: input.pay === null ? null : input.pay === 0 ? 'none' : 'stipend',
    pay_amount_cents: input.pay,
    pay_period: input.pay === null ? null : 'year',
    pay_change_note: null,
    benefits: null,
    hours_per_week: input.hours,
    full_time: null,
    meeting_times: null,
    fits_day_job: null,
    filing_fee_cents: null,
    signatures_required: null,
    where_to_file: null,
    eligibility: null,
    field_meta: input.fieldMeta,
  });
}

/** Every output row of the state's co-ops and public power facts; reads nothing outside `input`. */
export async function buildCoops(input: CoopsInput): Promise<CoopsOutput> {
  const counts = new Counts();
  for (const name of COUNT_NAMES) counts.add(name, 0);
  const checkedAt = input.now.toISOString();
  const jurisdictions: BJurisdiction[] = [];
  const districts: BDistrict[] = [];
  const fallbacks: BDistrictFallback[] = [];
  const geometry: BGeometry[] = [];
  const offices: BOffice[] = [];
  const powers: BOfficePower[] = [];
  const people = new Map<string, BPerson>();
  const holders = new Map<string, BOfficeholder>();
  const refs: OfficeRefRow[] = [];

  type Planned = {
    coop: CoopFacts;
    jk: string;
    dk: string;
    name: string;
    board: Board | null;
    identity: string;
  };
  const planned: Planned[] = [];
  for (const coop of [...input.coops].sort((a, b) => byteOrder(a.utilityNumber, b.utilityNumber))) {
    counts.add('coops');
    const jk = `coop:${coop.utilityNumber}`;
    const dk = `county_approx:${jk}`;
    const name = titleCaseUnitName(coop.name);
    const served = coop.counties.map((geoid) => ({ geoid, county: input.counties.get(geoid) }));
    jurisdictions.push(
      BJurisdictionSchema.parse({
        source_key: jk,
        kind: 'coop',
        name,
        state: input.state,
        census_id: null,
        parent_key: null,
        population: null,
        website: null,
        timezone: input.zoneForCoop(
          input.state,
          served.map(({ geoid, county }) => ({ geoid, population: county?.population ?? null })),
        ),
        budget_cents: null,
        budget_year: null,
        census_active: null,
        label_lng: null,
        label_lat: null,
        field_meta: {},
      }),
    );
    if (coop.counties.length === 0) counts.add('coop_no_county');
    const via: { districtKey: string; row: BGeometry }[] = [];
    for (const { county } of served) {
      if (county?.geometry === null || county?.geometry === undefined) {
        counts.add('county_without_base');
        continue;
      }
      via.push({ districtKey: county.districtKey, row: county.geometry });
    }
    via.sort((a, b) => byteOrder(a.districtKey, b.districtKey));
    const geom =
      via.length === 0
        ? BGeometrySchema.parse({
            source_key: dk,
            lookup_wkb: null,
            display_wkb: null,
            label_point: null,
            outline_svg: null,
            outline_bbox: null,
            geom_hash: fallbackGeomHash([]),
          })
        : await input.fallbackRow(
            dk,
            via.map((v) => v.row),
          );
    geometry.push(geom);
    districts.push(
      BDistrictSchema.parse({
        source_key: dk,
        jurisdiction_key: jk,
        name,
        level: 'special',
        geometry_quality: 'county_approx',
        geom_hash: geom.geom_hash,
        population: null,
        population_18: null,
        lean: null,
        lean_basis: null,
        field_meta: {},
      }),
    );
    for (const v of via) {
      fallbacks.push(
        BDistrictFallbackSchema.parse({
          source_key: `${dk}|${v.districtKey}`,
          district_key: dk,
          via_district_key: v.districtKey,
        }),
      );
    }

    let board: Board | null = null;
    if (coop.match.kind === 'unmatched') {
      counts.add(coop.match.reason);
    } else if (coop.match.ret.board === 'not_990') {
      counts.add('not_990');
    } else if (!coop.match.ret.board.is501c12) {
      counts.add('not_501c12');
    } else {
      board = { ret: coop.match.ret, board: coop.match.ret.board };
      counts.add('matched');
      if (board.board.membersElect === false) {
        counts.add('board_not_member_elected');
        continue;
      }
    }
    planned.push({
      coop,
      jk,
      dk,
      name,
      board,
      identity: officeIdentity(jk, OFFICE_TYPE, dk),
    });
  }

  const slugs = input.assignSlugs(
    planned.map((p) => ({
      identity: p.identity,
      base: officeSlugBase(input.state, p.name, OFFICE_TITLE),
    })),
  );
  const defaults = input.relevanceDefaults.get(OFFICE_TYPE) ?? new Map<string, 1 | 2 | 3>();
  for (const p of planned) {
    const slug = slugs.get(p.identity);
    if (slug === undefined) {
      counts.add('slug_unassigned');
      continue;
    }
    const fieldMeta: FieldMetaMap = {};
    let seats = 1;
    let bodySize: number | null = null;
    let pay: number | null = null;
    let hours: number | null = null;
    if (p.board !== null) {
      const { ret, board } = p.board;
      const source = returnSourceUrl(ret);
      if (board.boardSize !== null && board.boardSize >= 1 && board.boardSize <= MAX_SEATS) {
        seats = board.boardSize;
        bodySize = board.boardSize;
        const m = meta(source, board.boardSizeQuote, ret.retrievedAt);
        fieldMeta['seats'] = m;
        fieldMeta['body_size'] = m;
      }
      const median = medianPay(board.directors);
      if (median !== null) {
        pay = median.cents;
        const quote = median.middle
          .flatMap((d) => [d.quotes.comp, d.quotes.other])
          .filter((q): q is string => q !== null)
          .join(' ');
        const m = meta(source, quote, ret.retrievedAt);
        for (const field of ['pay_annual_cents', 'pay_amount_cents', 'pay_kind', 'pay_period']) {
          fieldMeta[field] = m;
        }
      }
      const timed = medianHours(board.directors);
      if (timed !== null && timed.hours > 0 && timed.hours <= MAX_HOURS) {
        hours = timed.hours;
        const quote = timed.middle
          .map((d) => d.quotes.hours)
          .filter((q): q is string => q !== null)
          .join(' ');
        fieldMeta['hours_per_week'] = meta(source, quote, ret.retrievedAt);
      }
    }
    if (p.coop.customers !== null) {
      fieldMeta['electorate'] = meta(
        EIA_URL,
        `Utility Number ${p.coop.utilityNumber}: ${p.coop.name}, total retail customers ${String(p.coop.customers)}`,
        checkedAt,
      );
    }
    offices.push(
      officeRow({
        slug,
        jurisdictionKey: p.jk,
        districtKey: p.dk,
        seats,
        bodySize,
        electorate: p.coop.customers,
        pay,
        hours,
        fieldMeta,
      }),
    );
    for (const [powerId, relevance] of [...defaults].sort((a, b) => byteOrder(a[0], b[0]))) {
      powers.push(
        BOfficePowerSchema.parse({
          source_key: `${slug}|${powerId}`,
          office_key: slug,
          power_id: powerId,
          relevance,
          quote: null,
          source_url: null,
          confidence: 'low',
          checked_at: null,
        }),
      );
    }
    refs.push(
      OfficeRefRowSchema.parse({
        slug,
        identity: p.identity,
        origin: 's02-coops',
        template_key: null,
        office_type_id: OFFICE_TYPE,
        jurisdiction_kind: 'coop',
        jurisdiction_key: p.jk,
        district_key: p.dk,
        county_geoid: null,
        party: null,
        party_selection: null,
        partisan: false,
        schedule: null,
        track_set: null,
        stagger: [],
        stagger_group: null,
        seats,
        body_size: bodySize,
        term_years: null,
        pay_annual_cents: pay,
        pay_range: null,
        template_seats: null,
        population: null,
      }),
    );
    if (p.board === null) continue;
    for (const director of p.board.board.directors) {
      const parts = parseName(director.name, 'auto');
      const key = nameKey(parts.first, parts.last);
      if (key === null) {
        counts.add('director_unnamed');
        continue;
      }
      const personKey = `irs990:${p.board.ret.ein}:${key}`;
      if (!people.has(personKey)) {
        people.set(
          personKey,
          BPersonSchema.parse({
            source_key: personKey,
            slug: personSlug(director.name, personKey),
            name: director.name,
            first_name: parts.first,
            middle_name: parts.middle,
            last_name: parts.last,
            suffix: parts.suffix,
            party: null,
            photo: null,
            website: null,
            roster_only: true,
            origin: { created_by: 'bundle', key: personKey, datasets: PERSON_DATASETS },
          }),
        );
      }
      const holderKey = `${slug}|${personKey}|`;
      if (!holders.has(holderKey)) {
        holders.set(
          holderKey,
          BOfficeholderSchema.parse({
            source_key: holderKey,
            office_key: slug,
            person_key: personKey,
            seat_label: null,
            since: null,
            until: null,
            seat_up_next: null,
            term_limited: null,
            not_running: null,
            cash_on_hand_cents: null,
            cash_as_of: null,
            cash_source_url: null,
          }),
        );
      }
    }
  }

  const facts: Fact[] = [];
  for (const match of input.publicPower) {
    const safe = match.website === null ? null : parseSafeUrl(match.website, SOURCE_URL_MAX);
    if (safe === null) continue;
    facts.push({
      table: 'jurisdictions',
      key: match.jurisdictionKey,
      field: 'website',
      value: safe.url,
      evidence: datasetEvidence(safe.url, {
        source_url: EIA_URL,
        quote: `Utility Number ${match.utilityNumber}: ${match.name}`,
        checked_at: checkedAt,
      }),
      origin: 's02-coops',
    });
  }

  const bySource = <T extends { source_key: string }>(rows: T[]): T[] =>
    rows.sort((a, b) => byteOrder(a.source_key, b.source_key));
  return {
    jurisdictions: bySource(jurisdictions),
    districts: bySource(districts),
    districtFallbacks: bySource(fallbacks),
    geometry: bySource(geometry),
    offices: bySource(offices),
    officePowers: bySource(powers),
    people: bySource([...people.values()]),
    officeholders: bySource([...holders.values()]),
    officeRefs: refs.sort((a, b) => byteOrder(a.slug, b.slug)),
    facts: facts.sort((a, b) => byteOrder(`${a.key}|${a.field}`, `${b.key}|${b.field}`)),
    counts: counts.record(),
  };
}

// ---------------------------------------------------------------------------------------------
// The stage module

export type S02CoopsDeps = {
  readonly countyAttributes: (ctx: RunContext) => Promise<readonly CountyAttributes[]>;
};

type National = {
  readonly utilities: readonly EiaUtility[];
  /** The selected co-ops with their resolved counties and assigned state. */
  readonly coops: readonly { utility: EiaUtility; counties: readonly string[]; state: string }[];
  readonly unresolved: readonly { utilityNumber: string; state: string; county: string }[];
  readonly customers: ReadonlyMap<string, number>;
  readonly customersRead: boolean;
  readonly stateFips: ReadonlyMap<string, string>;
};

type Returns = {
  /** Per EIN the newest index row and its year, from the 2026 index and then the 2025 one. */
  readonly rows: ReadonlyMap<string, { row: IndexRow; year: IndexYear }>;
  readonly files: ReadonlyMap<
    string,
    { year: IndexYear; xml: string; retrievedAt: string; batch: string }
  >;
  readonly unavailableBatches: ReadonlySet<string>;
  readonly years: ReadonlySet<IndexYear>;
  /** The blocking check the index failed, with its detail, or null. */
  readonly failure: { name: string; detail: string } | null;
};

const UnresolvedFileSchema = z.strictObject({
  run_id: z.string(),
  written_at: z.string(),
  unresolved: z.array(
    z.strictObject({ utility_number: z.string(), state: z.string(), county: z.string() }),
  ),
});

const STAGE_DISTRICT_KEY = /^tiger:state:(\d{2})$/;
const COUNTY_DISTRICT_KEY = /^tiger:county:(\d{5})$/;

/** The states with a complete stage 1 output (`_meta.json` written), without `US`. */
async function baseStates(ctx: RunContext): Promise<readonly string[]> {
  return (await listStageStates(ctx, 's01-base')).filter((state) => state !== 'US');
}

function failed(name: string, detail: string): StageResult {
  return { files: [], checks: [{ name, passed: false, detail }], datasets: {} };
}

function unavailableCheck(error: DatasetUnavailableError): { name: string; detail: string } {
  return { name: `dataset_unavailable:${error.dataset}`, detail: error.reason };
}

/** Stage 2's co-op module over the given county attribute reader (the national TIGER county layer by default). */
export function makeS02Coops(deps: S02CoopsDeps): StageModule {
  const nationals = new WeakMap<RunContext, Promise<National>>();
  const returnsByRun = new WeakMap<RunContext, Promise<Returns>>();
  const countiesByRun = new WeakMap<
    RunContext,
    Map<string, Promise<ReadonlyMap<string, ServedCounty>>>
  >();
  const listingByRun = new WeakMap<RunContext, Promise<readonly ParsedListingRow[] | null>>();

  const national = (ctx: RunContext, opts: StageOptions): Promise<National> => {
    let found = nationals.get(ctx);
    if (found === undefined) {
      found = loadNational(ctx, opts);
      nationals.set(ctx, found);
      found.catch(() => nationals.delete(ctx));
    }
    return found;
  };

  const loadNational = async (ctx: RunContext, opts: StageOptions): Promise<National> => {
    const { files } = await loadEia861(ctx);
    const utilities = eiaUtilities(files);
    const territory = eiaTerritory(files);
    const stateFips = new Map(PIPELINE_STATES.map((s) => [s.code, s.fips] as const));
    for (const state of await baseStates(ctx)) {
      if (stateFips.has(state)) continue;
      for await (const row of readStageRows(
        ctx.bucket,
        's01-base',
        state,
        'districts',
        BDistrictSchema,
      )) {
        const fips = STAGE_DISTRICT_KEY.exec(row.source_key)?.[1];
        if (fips !== undefined) stateFips.set(state, fips);
      }
    }
    const stateOfFips = new Map([...stateFips].map(([state, fips]) => [fips, state] as const));
    const { resolved, unresolved } = resolveCounties(
      territory,
      await deps.countyAttributes(ctx),
      stateFips,
      await loadCountyNameOverrides(),
    );
    const coops = selectCoops(utilities, new Set(territory.map((t) => t.utilityNumber))).map(
      (utility) => {
        const counties = resolved.get(utility.utilityNumber) ?? [];
        return { utility, counties, state: assignState(utility, counties, stateOfFips) };
      },
    );
    const columns = eiaColumnSources(files);
    ctx.log.info('coops.eia_columns', { city: columns.city, website: columns.website });
    if (!opts.dryRun) {
      await ctx.bucket.putJson(
        bucketKeys.coopsUnresolved(),
        {
          run_id: ctx.runId,
          written_at: ctx.now.toISOString(),
          unresolved: [...unresolved]
            .sort(
              (a, b) =>
                byteOrder(a.state, b.state) ||
                byteOrder(a.utilityNumber, b.utilityNumber) ||
                byteOrder(a.county, b.county),
            )
            .map((u) => ({ utility_number: u.utilityNumber, state: u.state, county: u.county })),
        },
        UnresolvedFileSchema,
      );
    }
    return {
      utilities,
      coops,
      unresolved,
      customers: retailCustomers(files.salesUltCust),
      customersRead: customersReadable(files.salesUltCust),
      stateFips,
    };
  };

  /**
   * The returns every co-op of every state with a stage 1 output may need, fetched once per run,
   * so a batch shared by several states is downloaded once.
   */
  const returns = (ctx: RunContext, nat: National): Promise<Returns> => {
    let found = returnsByRun.get(ctx);
    if (found === undefined) {
      found = loadReturns(ctx, nat);
      returnsByRun.set(ctx, found);
      found.catch(() => returnsByRun.delete(ctx));
    }
    return found;
  };

  const loadReturns = async (ctx: RunContext, nat: National): Promise<Returns> => {
    const overrides = await loadCoopEinOverrides();
    const states = new Set(await baseStates(ctx));
    const eins = new Set<string>();
    for (const state of [...new Set(nat.coops.map((c) => c.state))].sort()) {
      if (!states.has(state)) continue;
      let eo: readonly EoRow[];
      try {
        eo = (await loadEoBmf(ctx, state)).rows;
      } catch (error) {
        if (error instanceof EoHeaderError || error instanceof DatasetUnavailableError) continue;
        throw error;
      }
      for (const coop of nat.coops.filter((c) => c.state === state)) {
        for (const ein of wantedEins({
          utility: coop.utility,
          candidates: einCandidates(coop.utility, eo),
          override: overrideOf(overrides, coop.utility.utilityNumber),
        })) {
          eins.add(ein);
        }
      }
    }
    const rows = new Map<string, { row: IndexRow; year: IndexYear }>();
    const files = new Map<
      string,
      { year: IndexYear; xml: string; retrievedAt: string; batch: string }
    >();
    const unavailable = new Set<string>();
    const years = new Set<IndexYear>();
    if (eins.size === 0) {
      return { rows, files, unavailableBatches: unavailable, years, failure: null };
    }
    try {
      let remaining = new Set(eins);
      for (const year of [2026, 2025] as const) {
        if (remaining.size === 0) break;
        const index = await loadIndex(ctx, year);
        years.add(year);
        const latest = latestReturns(await index.rows(remaining));
        for (const [ein, row] of latest) rows.set(ein, { row, year });
        const fetched = await fetchReturns(ctx, year, [...latest.values()]);
        for (const [objectId, file] of fetched.returns) {
          files.set(objectId, {
            year,
            xml: file.xml,
            retrievedAt: file.retrievedAt,
            batch: file.batch,
          });
        }
        for (const batch of fetched.batchUnavailable) unavailable.add(`${String(year)}/${batch}`);
        remaining = new Set([...remaining].filter((ein) => !latest.has(ein)));
      }
    } catch (error) {
      if (error instanceof IrsIndexHeaderError) {
        return {
          rows,
          files,
          unavailableBatches: unavailable,
          years,
          failure: { name: 'irs_index_header', detail: 'header' },
        };
      }
      if (error instanceof DatasetUnavailableError) {
        return {
          rows,
          files,
          unavailableBatches: unavailable,
          years,
          failure: unavailableCheck(error),
        };
      }
      throw error;
    }
    return { rows, files, unavailableBatches: unavailable, years, failure: null };
  };

  /** Every stage 1 county of the state: its district key, population, zone and geometry (without lookup WKB). */
  const stateCounties = async (
    ctx: RunContext,
    state: string,
  ): Promise<Map<string, ServedCounty>> => {
    const out = new Map<string, ServedCounty>();
    const meta = await readStageMeta(ctx.bucket, 's01-base', state);
    if (meta === null) return out;
    const listed = new Set(meta.files.map((f) => f.name));
    const jurisdictions = new Map<string, { population: number | null; timezone: string | null }>();
    if (listed.has('jurisdictions')) {
      for await (const j of readStageRows(
        ctx.bucket,
        's01-base',
        state,
        'jurisdictions',
        BJurisdictionSchema,
      )) {
        if (j.kind === 'county')
          jurisdictions.set(j.source_key, { population: j.population, timezone: j.timezone });
      }
    }
    const byKey = new Map<
      string,
      { geoid: string; population: number | null; timezone: string | null }
    >();
    if (listed.has('districts')) {
      for await (const d of readStageRows(
        ctx.bucket,
        's01-base',
        state,
        'districts',
        BDistrictSchema,
      )) {
        const geoid = COUNTY_DISTRICT_KEY.exec(d.source_key)?.[1];
        if (geoid === undefined) continue;
        const j = jurisdictions.get(d.jurisdiction_key);
        byKey.set(d.source_key, {
          geoid,
          population: d.population ?? j?.population ?? null,
          timezone: j?.timezone ?? null,
        });
      }
    }
    const geometryOf = new Map<string, BGeometry>();
    if (listed.has('geometry')) {
      for await (const g of readStageRows(
        ctx.bucket,
        's01-base',
        state,
        'geometry',
        BGeometrySchema,
      )) {
        if (byKey.has(g.source_key)) geometryOf.set(g.source_key, { ...g, lookup_wkb: null });
      }
    }
    for (const [key, county] of byKey) {
      out.set(county.geoid, {
        districtKey: key,
        population: county.population,
        timezone: county.timezone,
        geometry: geometryOf.get(key) ?? null,
      });
    }
    return out;
  };

  /** The stage 1 counties of the served states (by FIPS code), read once per run and state. */
  const servedCounties = async (
    ctx: RunContext,
    nat: National,
    fipsCodes: readonly string[],
  ): Promise<ReadonlyMap<string, ServedCounty>> => {
    let byFips = countiesByRun.get(ctx);
    if (byFips === undefined) {
      byFips = new Map();
      countiesByRun.set(ctx, byFips);
    }
    const merged = new Map<string, ServedCounty>();
    for (const fips of fipsCodes) {
      let found = byFips.get(fips);
      if (found === undefined) {
        const state = [...nat.stateFips].find(([, f]) => f === fips)?.[0];
        found = state === undefined ? Promise.resolve(new Map()) : stateCounties(ctx, state);
        byFips.set(fips, found);
      }
      for (const [geoid, county] of await found) merged.set(geoid, county);
    }
    return merged;
  };

  const listing = (ctx: RunContext, state: string): Promise<readonly ParsedListingRow[] | null> => {
    let found = listingByRun.get(ctx);
    if (found === undefined) {
      found = (async () => {
        const meta = await readStageMeta(ctx.bucket, 's01-base', state);
        const edition = meta?.datasets['census-gus']?.edition ?? LISTING_EDITION;
        const rows: ParsedListingRow[] = [];
        try {
          for await (const row of readParsedListing(ctx, edition)) {
            if (row.tab === 'Special District' && row.function_name === PUBLIC_POWER_FUNCTION)
              rows.push(row);
          }
        } catch (error) {
          if (error instanceof DatasetFileMissingError) return null;
          throw error;
        }
        return rows;
      })();
      listingByRun.set(ctx, found);
      found.catch(() => listingByRun.delete(ctx));
    }
    return found;
  };

  return {
    id: 's02-coops',
    milestone: 2,
    blockingChecks: S02_COOPS_BLOCKING_CHECKS,
    states: (ctx) => baseStates(ctx),
    async run(ctx, state, opts): Promise<StageResult> {
      let nat: National;
      try {
        nat = await national(ctx, opts);
      } catch (error) {
        if (error instanceof EiaHeaderError) return failed('eia_header', 'header');
        if (error instanceof DatasetUnavailableError) {
          const check = unavailableCheck(error);
          return failed(check.name, check.detail);
        }
        throw error;
      }
      const overrides = await loadCoopEinOverrides();
      const mine = nat.coops.filter((c) => c.state === state);
      const datasets: Record<string, StageResult['datasets'][string]> = {
        [EIA_DATASET]: datasetEntry(ctx, EIA_DATASET, EIA_EDITION),
      };
      let eo: readonly EoRow[] = [];
      if (mine.length > 0) {
        try {
          eo = (await loadEoBmf(ctx, state)).rows;
        } catch (error) {
          if (error instanceof EoHeaderError) return failed('eobmf_header', 'header');
          if (error instanceof DatasetUnavailableError) {
            const check = unavailableCheck(error);
            return failed(check.name, check.detail);
          }
          throw error;
        }
        datasets[EOBMF_DATASET] = datasetEntry(ctx, EOBMF_DATASET, EOBMF_EDITION);
      }
      const found = await returns(ctx, nat);
      const candidatesOf = new Map(
        mine.map((c) => [c.utility.utilityNumber, einCandidates(c.utility, eo)] as const),
      );
      const needsReturns = mine.some(
        (c) =>
          wantedEins({
            utility: c.utility,
            candidates: candidatesOf.get(c.utility.utilityNumber) ?? [],
            override: overrideOf(overrides, c.utility.utilityNumber),
          }).length > 0,
      );
      if (needsReturns && found.failure !== null)
        return failed(found.failure.name, found.failure.detail);
      const newestYear = [...found.years].sort().reverse()[0];
      if (needsReturns && newestYear !== undefined) {
        datasets[IRS990_DATASET] = datasetEntry(ctx, IRS990_DATASET, String(newestYear));
      }

      const parsed = new Map<string, CoopReturn | null>();
      const returnOf = (ein: string): CoopReturn | null => {
        if (parsed.has(ein)) return parsed.get(ein) ?? null;
        const entry = found.rows.get(ein);
        const file = entry === undefined ? undefined : found.files.get(entry.row.objectId);
        const ret =
          entry === undefined || file === undefined
            ? null
            : {
                ein,
                objectId: entry.row.objectId,
                batch: file.batch,
                year: file.year,
                retrievedAt: file.retrievedAt,
                board: parseCoopReturn(file.xml),
              };
        parsed.set(ein, ret);
        return ret;
      };
      const websiteOf = (ein: string): string | null => {
        const board = returnOf(ein)?.board;
        return board === undefined || board === 'not_990' ? null : board.website;
      };
      const coops: CoopFacts[] = mine.map((c) => {
        const n = c.utility.utilityNumber;
        const ein = matchEin({
          utility: c.utility,
          candidates: candidatesOf.get(n) ?? [],
          override: overrideOf(overrides, n),
          websiteOf,
        });
        let match: CoopMatch;
        if (ein.kind === 'unmatched') {
          match = ein;
        } else {
          const ret = returnOf(ein.ein);
          const entry = found.rows.get(ein.ein);
          match =
            ret !== null
              ? { kind: 'return', ret }
              : {
                  kind: 'unmatched',
                  reason:
                    entry !== undefined &&
                    found.unavailableBatches.has(`${String(entry.year)}/${entry.row.batch}`)
                      ? 'batch_unavailable'
                      : 'no_return',
                };
        }
        return {
          utilityNumber: n,
          name: c.utility.name,
          counties: c.counties,
          customers: nat.customers.get(n) ?? null,
          match,
        };
      });

      const servedStates = [
        ...new Set(mine.flatMap((c) => c.counties.map((geoid) => geoid.slice(0, 2)))),
      ].sort();
      const counties = await servedCounties(ctx, nat, servedStates);
      const fips = nat.stateFips.get(state) ?? '';
      const listed = await listing(ctx, state);
      const power = matchPublicPower(nat.utilities, listed ?? [], state, fips);
      const register = await loadTimezoneRegister();
      const registry = await loadSlugRegistry(ctx.bucket, 'offices');
      const output = await buildCoops({
        state,
        today: ctx.today,
        now: ctx.now,
        coops,
        counties,
        publicPower: power.matches,
        relevanceDefaults: await loadRelevanceDefaults(repoRoot()),
        assignSlugs: (requests) => assignSlugs(registry, requests).assigned,
        fallbackRow,
        zoneForCoop: (st, served) => zoneForCoop(register, st, served),
      });

      const files = [
        await opts.out.writeRows('jurisdictions', output.jurisdictions),
        await opts.out.writeRows('districts', output.districts),
        await opts.out.writeRows('district_fallbacks', output.districtFallbacks),
        await opts.out.writeRows('geometry', output.geometry),
        await opts.out.writeRows('offices', output.offices),
        await opts.out.writeRows('office_powers', output.officePowers),
        await opts.out.writeRows('people', output.people),
        await opts.out.writeRows('officeholders', output.officeholders),
        await opts.out.writeRows(OFFICE_REFS_FILE, output.officeRefs),
        await opts.out.writeRows('facts', output.facts),
      ];
      const mineNumbers = new Set(mine.map((c) => c.utility.utilityNumber));
      const counts: Record<string, number> = {
        ...output.counts,
        county_unresolved: nat.unresolved.filter((u) => mineNumbers.has(u.utilityNumber)).length,
        public_power_matched: power.matched,
        public_power_missed: power.missed,
        public_power_ambiguous: power.ambiguous,
        public_power_listing_missing: listed === null ? 1 : 0,
        customers_file_unread: nat.customersRead ? 0 : 1,
      };
      const detail = Object.keys(counts)
        .sort()
        .map((name) => `${name}=${String(counts[name] ?? 0)}`)
        .join(' ');
      return { files, checks: [{ name: 'coops', passed: true, detail }], datasets };
    },
  };
}

function overrideOf(
  overrides: readonly CoopEinOverride[],
  utilityNumber: string,
): CoopEinOverride | undefined {
  return overrides.find((o) => String(o.eia_utility_number) === utilityNumber);
}

const COUNTY_LAYER = TIGER_LAYERS.find((layer) => layer.token === 'county');

/** The GEOID, STATEFP and NAME of every county in the national TIGER county layer of stage 1's edition. */
export async function tigerCountyAttributes(ctx: RunContext): Promise<readonly CountyAttributes[]> {
  if (COUNTY_LAYER === undefined) throw new Error('no TIGER county layer');
  const key = await ensureLayerFile(ctx, COUNTY_LAYER, 'us');
  if (key === null) throw new DatasetUnavailableError('tiger', 'no_national_county_file');
  const rows = await readDbf(key, ctx, ['GEOID', 'STATEFP', 'NAME']);
  return rows.map((row) => ({
    geoid: String(row['GEOID'] ?? ''),
    statefp: String(row['STATEFP'] ?? ''),
    name: String(row['NAME'] ?? ''),
  }));
}

/** Stage 2's co-op module over the national TIGER county layer. */
export const s02Coops: StageModule = makeS02Coops({ countyAttributes: tigerCountyAttributes });
