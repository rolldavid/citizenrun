// Stage 2, known bodies (PIPE-known-bodies): one office per state legislative district, the U.S.
// House and Senate offices, the current legislators and members of Congress as people and
// officeholders, and the photo pointers of the photo stage, from the Open States and
// congress-legislators files (D-313, D-314, D-320).
import { rulesFor } from '@citizenrun/rules';
import type { StateRules } from '@citizenrun/rules';
import {
  BDistrictSchema,
  BJurisdictionSchema,
  BOfficeholderSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BPersonSchema,
  SOURCE_URL_MAX,
  officeSlugBase,
  parseSafeUrl,
  personSlug,
} from '@citizenrun/shared';
import type {
  BDistrict,
  BOffice,
  BOfficePower,
  BOfficeholder,
  BPerson,
  FieldMetaMap,
  FieldMetaRow,
} from '@citizenrun/shared';
import { loadParties } from '../lib/data-files.ts';
import type { PartiesFile } from '../lib/data-files.ts';
import { normaliseParty } from '../lib/party.ts';
import type { RunContext, StageModule, StageResult } from '../lib/runner.ts';
import { assignSlugs, loadSlugRegistry, officeIdentity } from '../lib/slug.ts';
import type { SlugRegistry } from '../lib/slug.ts';
import { loadLegislators, parseLegislatorsCsv } from '../sources/congress.ts';
import type { Legislator } from '../sources/congress.ts';
import { DatasetUnavailableError, datasetEntry } from '../sources/dataset.ts';
import { mapperFor } from '../sources/openstates-districts/index.ts';
import { loadOpenStates, parseOpenStatesCsv, wikipediaUrls } from '../sources/openstates.ts';
import type { OpenStatesPerson } from '../sources/openstates.ts';
import type { CitedNode } from '../templates/cited.ts';
import type { GroundedMark } from '../templates/ground.ts';
import { citedConfidence, citedMeta, readTemplateOutput } from '../templates/output.ts';
import type { TemplateOutput } from '../templates/output.ts';
import type { ChamberEntry, FederalEntry, PayEntry, StaggerGroup } from '../templates/schema.ts';
import { fillLabel, fillTitle } from '../templates/title.ts';
import { contestsInWindow, nextElecting } from './shared/contests.ts';
import { OFFICE_REFS_FILE, OfficeRefRowSchema } from './shared/office-ref.ts';
import type { OfficeRefRow } from './shared/office-ref.ts';
import { PERSON_SOURCES_FILE, PersonSourceRowSchema } from './shared/person-source.ts';
import type { PersonSourceRow } from './shared/person-source.ts';
import { loadRelevanceDefaults } from './shared/reference.ts';
import type { RelevanceDefaults } from './shared/reference.ts';
import { repoRoot } from './shared/repo.ts';
import { listStageStates, loadStageRows } from './shared/stage-io.ts';
import { HOUSE_TERM, SENATE_CLASS_FIRST, SENATE_TERM, groundFederalTerms } from './federal.ts';
import type { FederalMarks } from './federal.ts';

export type SlugRequest = { identity: string; base: string };
export type SlugAssigner = (requests: readonly SlugRequest[]) => ReadonlyMap<string, string>;

export type KnownInput = {
  readonly state: string;
  readonly stateFips: string;
  readonly stateName: string;
  readonly today: string;
  readonly now: Date;
  readonly districts: readonly BDistrict[]; // stage 1's districts of the state
  readonly template: TemplateOutput | null; // stage 3's output, or null
  readonly rules: StateRules | null; // rulesFor(state)
  readonly openStates: readonly OpenStatesPerson[];
  readonly legislators: readonly Legislator[]; // already filtered to the state
  readonly federalMarks: FederalMarks;
  readonly relevanceDefaults: RelevanceDefaults;
  readonly parties: PartiesFile; // data/parties.yaml, for normaliseParty
  readonly assignSlugs: SlugAssigner; // PIPE-slugs over the offices registry snapshot
  readonly assignPersonSlugs: SlugAssigner; // PIPE-slugs over the people registry snapshot
  readonly openStatesCheckedAt: string;
  readonly legislatorsCheckedAt: string;
};

export const KNOWN_COUNTS = [
  'legislators',
  'legislator_unmapped',
  'members',
  'member_unmapped',
  'holder_position_unknown',
  'holders_exceed_seats',
  'district_group_unmatched',
] as const;
export type KnownCount = (typeof KNOWN_COUNTS)[number];

export type KnownOutput = {
  readonly offices: readonly BOffice[];
  readonly officePowers: readonly BOfficePower[];
  readonly people: readonly BPerson[];
  readonly officeholders: readonly BOfficeholder[];
  readonly officeRefs: readonly OfficeRefRow[];
  readonly personSources: readonly PersonSourceRow[];
  readonly counts: Readonly<Record<KnownCount, number>>;
};

/** The name given to `writeRows` for each of the stage's files. */
export const S02_KNOWN_FILES = {
  offices: 'offices',
  officePowers: 'office_powers',
  people: 'people',
  officeholders: 'officeholders',
  officeRefs: OFFICE_REFS_FILE,
  personSources: PERSON_SOURCES_FILE,
} as const;

type PowerDraft = Omit<BOfficePower, 'source_key' | 'office_key'>;

/** An office before its slug is known. */
type OfficeDraft = {
  readonly identity: string;
  readonly typeId: string;
  readonly districtKey: string;
  readonly title: string;
  readonly seats: number;
  readonly partisan: boolean | null;
  readonly termYears: number | null;
  readonly termLimitTerms: number | null;
  readonly pay: PayColumns;
  readonly schedule: string | null;
  readonly trackSet: string | null;
  readonly stagger: readonly StaggerGroup[];
  readonly staggerGroup: string | null;
  readonly fieldMeta: FieldMetaMap;
  readonly powers: readonly PowerDraft[];
  readonly templateSeats: number | null;
  readonly population: number | null;
  readonly holders: readonly string[]; // person keys
};

type PayColumns = {
  readonly pay_kind: BOffice['pay_kind'];
  readonly pay_amount_cents: number | null;
  readonly pay_period: BOffice['pay_period'];
  readonly pay_annual_cents: number | null;
};

const NO_PAY: PayColumns = {
  pay_kind: null,
  pay_amount_cents: null,
  pay_period: null,
  pay_annual_cents: null,
};

const MONTHS_PER_YEAR = 12;

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sortBy<T>(rows: readonly T[], key: (row: T) => string): T[] {
  return [...rows].sort((a, b) => byteOrder(key(a), key(b)));
}

const LEGISLATIVE_LAYERS = { sldu: 'state-senate', sldl: 'state-house' } as const;
type LegislativeLayer = keyof typeof LEGISLATIVE_LAYERS;

/** The district's GEOID: the part of its key after `tiger:<layer>:`. */
function geoidOf(key: string, layer: string): string {
  return key.slice(`tiger:${layer}:`.length);
}

/** `021` is `21`, `01A` is `1A`. */
function districtLabel(geoid: string): string {
  const code = geoid.slice(-3).replace(/^0+/, '');
  return code === '' ? '0' : code;
}

/** Pay columns from a template pay entry (T-offices); none for a county pay rule or a local value. */
function payColumns(
  pay: PayEntry | null,
  meta: FieldMetaRow | null,
): { columns: PayColumns; fieldMeta: FieldMetaMap } {
  if (pay === null || !('kind' in pay) || meta === null) {
    return { columns: NO_PAY, fieldMeta: {} };
  }
  const annual =
    pay.period === 'year'
      ? pay.amount_cents
      : pay.period === 'month'
        ? pay.amount_cents * MONTHS_PER_YEAR
        : null;
  const fieldMeta: FieldMetaMap = {
    pay_kind: meta,
    pay_amount_cents: meta,
    pay_period: meta,
  };
  if (annual !== null) {
    fieldMeta['pay_annual_cents'] = meta;
  }
  return {
    columns: {
      pay_kind: pay.kind,
      pay_amount_cents: pay.amount_cents,
      pay_period: pay.period,
      pay_annual_cents: annual,
    },
    fieldMeta,
  };
}

/** A cited value and its `field_meta` entry, or null and no entry. */
function citedValue<T>(
  template: TemplateOutput,
  path: string,
  node: (CitedNode & { readonly value: T }) | null,
): { value: T | null; meta: FieldMetaRow | null } {
  return node === null
    ? { value: null, meta: null }
    : { value: node.value, meta: citedMeta(template, path, node) };
}

function defaultPowers(defaults: RelevanceDefaults, typeId: string): readonly PowerDraft[] {
  const powers = defaults.get(typeId);
  if (powers === undefined) {
    return [];
  }
  return [...powers.entries()].map(([powerId, relevance]) => ({
    power_id: powerId,
    relevance,
    quote: null,
    source_url: null,
    confidence: 'low' as const,
    checked_at: null,
  }));
}

function chamberPowers(
  template: TemplateOutput,
  base: string,
  entry: ChamberEntry,
  defaults: RelevanceDefaults,
): readonly PowerDraft[] {
  if (entry.powers.length === 0) {
    return defaultPowers(defaults, entry.office_type);
  }
  return entry.powers.map((power, j) => {
    const path = `${base}.powers.${String(j)}`;
    return {
      power_id: power.power,
      relevance: power.relevance,
      quote: power.quote,
      source_url: power.source_url,
      confidence: citedConfidence(template, path),
      checked_at: template.grounded[path]?.checked_at ?? null,
    };
  });
}

/** The `district_groups` item a district label belongs to, or null. */
function matchGroup(
  entry: ChamberEntry,
  label: string,
): ChamberEntry['district_groups'][number] | null {
  const number = /^\d+$/.test(label) ? Number(label) : null;
  for (const item of entry.district_groups) {
    const { districts } = item;
    if (districts === 'all') {
      return item;
    }
    if (districts === 'odd' || districts === 'even') {
      if (number !== null && number % 2 === (districts === 'odd' ? 1 : 0)) {
        return item;
      }
      continue;
    }
    if (districts.includes(label)) {
      return item;
    }
  }
  return null;
}

/** A federal term's `field_meta` entry: medium when its quote is grounded, low otherwise. */
function federalTermMeta(node: CitedNode, mark: GroundedMark, now: Date): FieldMetaRow {
  return {
    source_url: node.source_url,
    quote: node.quote,
    confidence: mark.grounded ? 'medium' : 'low',
    checked_at: mark.checked_at ?? now.toISOString(),
    rule_citation: node.citation,
  };
}

function federalEntryFields(
  template: TemplateOutput | null,
  block: 'us_house' | 'us_senate',
): {
  partisan: boolean | null;
  schedule: string | null;
  trackSet: string | null;
  fieldMeta: FieldMetaMap;
} {
  if (template === null) {
    return { partisan: null, schedule: null, trackSet: null, fieldMeta: {} };
  }
  const entry: FederalEntry = template.template.federal[block];
  const partisan = citedValue(template, `federal.${block}.partisan`, entry.partisan);
  return {
    partisan: partisan.value,
    schedule: entry.schedule,
    trackSet: entry.track_set,
    fieldMeta: partisan.meta === null ? {} : { partisan: partisan.meta },
  };
}

/** The member's Wikipedia page from `wikipedia_id`, spaces as underscores, URL-encoded. */
function congressWikipedia(title: string | null): readonly string[] {
  if (title === null) {
    return [];
  }
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return parseSafeUrl(url, SOURCE_URL_MAX) === null ? [] : [url];
}

function partyOf(label: string | null, parties: PartiesFile): string | null {
  return label === null ? null : normaliseParty(label, parties);
}

/** The known bodies of one state, from its stage 1 districts and the two files (pure). */
export function buildKnownBodies(input: KnownInput): KnownOutput {
  const { state, stateFips, template, rules } = input;
  const jurisdictionKey = `state:${state}`;
  const counts: Record<KnownCount, number> = {
    legislators: 0,
    legislator_unmapped: 0,
    members: 0,
    member_unmapped: 0,
    holder_position_unknown: 0,
    holders_exceed_seats: 0,
    district_group_unmatched: 0,
  };

  // The legislative districts, without TIGER's "not defined" areas.
  const legislative = new Map<string, { layer: LegislativeLayer; district: BDistrict }>();
  for (const district of input.districts) {
    for (const layer of ['sldu', 'sldl'] as const) {
      if (
        district.source_key.startsWith(`tiger:${layer}:`) &&
        !geoidOf(district.source_key, layer).endsWith('ZZZ')
      ) {
        legislative.set(district.source_key, { layer, district });
      }
    }
  }

  // Legislators to districts. People are kept whether or not they map.
  const people = new Map<string, Omit<BPerson, 'slug'>>();
  const personSources = new Map<string, PersonSourceRow>();
  const mappedTo = new Map<string, string[]>(); // district key to person keys
  const mapper = mapperFor(state, stateFips);
  for (const person of input.openStates) {
    const key = `openstates:${person.id}`;
    if (people.has(key)) {
      continue;
    }
    counts.legislators += 1;
    people.set(key, {
      source_key: key,
      name: person.name,
      first_name: person.givenName,
      middle_name: null,
      last_name: person.familyName,
      suffix: null,
      party: partyOf(person.currentParty, input.parties),
      photo: null,
      website: null,
      roster_only: false,
      origin: { created_by: 'bundle', key, datasets: ['openstates'] },
    });
    personSources.set(key, {
      person_key: key,
      bioguide: null,
      wikipedia_urls: [...wikipediaUrls(person)],
      wikidata_qid: null,
      nickname_alias: null,
    });
    const chamber = person.currentChamber === 'lower' ? 'lower' : 'upper';
    const layer = chamber === 'lower' ? 'sldl' : 'sldu';
    const geoid = mapper(chamber, person.currentDistrict);
    const districtKey = geoid === null ? null : `tiger:${layer}:${geoid}`;
    if (districtKey === null || !legislative.has(districtKey)) {
      counts.legislator_unmapped += 1;
      continue;
    }
    mappedTo.set(districtKey, [...(mappedTo.get(districtKey) ?? []), key]);
  }

  // The legislative offices.
  const drafts: OfficeDraft[] = [];
  const chambers = template?.template.legislature ?? [];
  for (const [districtKey, { layer, district }] of sortBy(
    [...legislative.entries()],
    ([key]) => key,
  )) {
    const typeId = LEGISLATIVE_LAYERS[layer];
    const label = districtLabel(geoidOf(districtKey, layer));
    const holders = mappedTo.get(districtKey) ?? [];
    const index = chambers.findIndex((entry) => entry.office_type === typeId);
    const entry = chambers[index];
    const common = {
      typeId,
      districtKey,
      population: district.population,
    };
    if (template === null || entry === undefined) {
      drafts.push({
        ...common,
        identity: officeIdentity(jurisdictionKey, typeId, districtKey),
        title: district.name,
        seats: Math.max(1, holders.length),
        partisan: null,
        termYears: null,
        termLimitTerms: null,
        pay: NO_PAY,
        schedule: null,
        trackSet: null,
        stagger: [],
        staggerGroup: null,
        fieldMeta: {},
        powers: defaultPowers(input.relevanceDefaults, typeId),
        templateSeats: null,
        holders,
      });
      continue;
    }
    const base = `legislature.${String(index)}`;
    const partisan = citedValue(template, `${base}.partisan`, entry.partisan);
    const termYears = citedValue(template, `${base}.term_years`, entry.term_years);
    const termLimit = citedValue(template, `${base}.term_limit_terms`, entry.term_limit_terms);
    const payNode = entry.pay !== null && 'kind' in entry.pay ? entry.pay : null;
    const pay = payColumns(
      entry.pay,
      payNode === null ? null : citedMeta(template, `${base}.pay`, payNode),
    );
    const fieldMeta: FieldMetaMap = { ...pay.fieldMeta };
    if (partisan.meta !== null) fieldMeta['partisan'] = partisan.meta;
    if (termYears.meta !== null) fieldMeta['term_years'] = termYears.meta;
    if (termLimit.meta !== null) fieldMeta['term_limit_terms'] = termLimit.meta;
    const group = matchGroup(entry, label);
    if (group === null) {
      counts.district_group_unmatched += 1;
    }
    const powers = chamberPowers(template, base, entry, input.relevanceDefaults);
    const perDistrict = entry.seats_per_district;
    const countPath = `${base}.seats_per_district.count`;
    const templateSeats =
      perDistrict !== null && citedConfidence(template, countPath) === 'medium'
        ? perDistrict.count.value
        : null;
    const office = (
      typePart: string,
      seats: number,
      title: string,
      officeHolders: readonly string[],
    ): OfficeDraft => ({
      ...common,
      identity: officeIdentity(jurisdictionKey, typePart, districtKey),
      title,
      seats,
      partisan: partisan.value,
      termYears: termYears.value,
      termLimitTerms: termLimit.value,
      pay: pay.columns,
      schedule: entry.schedule,
      trackSet: entry.track_set,
      stagger:
        group === null
          ? []
          : [{ group: group.group, seats, every: group.every, first: group.first }],
      staggerGroup: group?.group ?? null,
      fieldMeta,
      powers,
      templateSeats,
      holders: officeHolders,
    });
    if (perDistrict === null) {
      drafts.push(office(typeId, 1, fillTitle(entry.title, { label }), holders));
    } else if (perDistrict.arrangement === 'together') {
      drafts.push(
        office(typeId, perDistrict.count.value, fillTitle(entry.title, { label }), holders),
      );
    } else {
      // The file names no position, so a legislator of a positions chamber is placed in none.
      counts.holder_position_unknown += holders.length;
      for (let n = 1; n <= perDistrict.count.value; n += 1) {
        const pattern = perDistrict.position_label_pattern;
        const position = pattern === null ? String(n) : fillLabel(pattern, n);
        drafts.push(
          office(
            `${typeId}:position-${String(n)}`,
            1,
            fillTitle(entry.title, { label, position }),
            [],
          ),
        );
      }
    }
  }

  // Congress.
  const houseDistricts = sortBy(
    input.districts.filter(
      (d) => d.source_key.startsWith('tiger:cd:') && !geoidOf(d.source_key, 'cd').endsWith('ZZ'),
    ),
    (d) => d.source_key,
  );
  const houseKeys = new Set(houseDistricts.map((d) => d.source_key));
  const houseHolders = new Map<string, string[]>();
  const senateHolders = new Map<1 | 2 | 3, string[]>();
  for (const member of input.legislators) {
    const key = `bioguide:${member.bioguide}`;
    if (people.has(key)) {
      continue;
    }
    counts.members += 1;
    people.set(key, {
      source_key: key,
      name: member.fullName,
      first_name: member.firstName === '' ? null : member.firstName,
      middle_name: member.middleName,
      last_name: member.lastName,
      suffix: member.suffix,
      party: partyOf(member.party, input.parties),
      photo: null,
      website: null,
      roster_only: false,
      origin: { created_by: 'bundle', key, datasets: ['congress-legislators'] },
    });
    personSources.set(key, {
      person_key: key,
      bioguide: member.bioguide,
      wikipedia_urls: [...congressWikipedia(member.wikipediaTitle)],
      wikidata_qid: null,
      nickname_alias:
        member.nickname === null ? null : `${member.nickname} ${member.lastName}`.slice(0, 200),
    });
    if (member.type === 'sen') {
      if (member.senateClass === null) {
        counts.member_unmapped += 1;
        continue;
      }
      senateHolders.set(member.senateClass, [
        ...(senateHolders.get(member.senateClass) ?? []),
        key,
      ]);
      continue;
    }
    let districtKey: string | null =
      member.district === null
        ? null
        : `tiger:cd:${stateFips}${String(member.district).padStart(2, '0')}`;
    if (districtKey === null || !houseKeys.has(districtKey)) {
      // An at-large seat or a delegate maps to the state's one feature, whatever its code.
      districtKey = houseDistricts.length === 1 ? (houseDistricts[0]?.source_key ?? null) : null;
    }
    if (districtKey === null) {
      counts.member_unmapped += 1;
      continue;
    }
    houseHolders.set(districtKey, [...(houseHolders.get(districtKey) ?? []), key]);
  }

  const houseFields = federalEntryFields(template, 'us_house');
  for (const district of houseDistricts) {
    drafts.push({
      identity: officeIdentity(jurisdictionKey, 'us-house', district.source_key),
      typeId: 'us-house',
      districtKey: district.source_key,
      title: `U.S. Representative, ${district.name}`,
      seats: 1,
      partisan: houseFields.partisan,
      termYears: HOUSE_TERM.value,
      termLimitTerms: null,
      pay: NO_PAY,
      schedule: houseFields.schedule,
      trackSet: houseFields.trackSet,
      stagger: [],
      staggerGroup: null,
      fieldMeta: {
        ...houseFields.fieldMeta,
        term_years: federalTermMeta(HOUSE_TERM, input.federalMarks.house, input.now),
      },
      powers: defaultPowers(input.relevanceDefaults, 'us-house'),
      templateSeats: null,
      population: district.population,
      holders: houseHolders.get(district.source_key) ?? [],
    });
  }

  const stateDistrict = input.districts.find((d) => d.source_key === `tiger:state:${stateFips}`);
  const senateFields = federalEntryFields(template, 'us_senate');
  for (const senateClass of [1, 2, 3] as const) {
    const holders = senateHolders.get(senateClass);
    if (holders === undefined) {
      continue;
    }
    const districtKey = `tiger:state:${stateFips}`;
    drafts.push({
      identity: officeIdentity(
        jurisdictionKey,
        `us-senate:class-${String(senateClass)}`,
        districtKey,
      ),
      typeId: 'us-senate',
      districtKey,
      title: `U.S. Senator, Class ${String(senateClass)}`,
      seats: 1,
      partisan: senateFields.partisan,
      termYears: SENATE_TERM.value,
      termLimitTerms: null,
      pay: NO_PAY,
      schedule: senateFields.schedule,
      trackSet: senateFields.trackSet,
      stagger: [{ group: 'A', seats: 1, every: 6, first: SENATE_CLASS_FIRST[senateClass] }],
      staggerGroup: 'A',
      fieldMeta: {
        ...senateFields.fieldMeta,
        term_years: federalTermMeta(SENATE_TERM, input.federalMarks.senate, input.now),
      },
      powers: defaultPowers(input.relevanceDefaults, 'us-senate'),
      templateSeats: null,
      population: stateDistrict?.population ?? null,
      holders,
    });
  }

  // Slugs: all of the state's requests in one call each.
  const officeSlugs = input.assignSlugs(
    drafts.map((d) => ({
      identity: d.identity,
      base: officeSlugBase(state, input.stateName, d.title),
    })),
  );
  const personSlugs = input.assignPersonSlugs(
    [...people.values()].map((p) => ({
      identity: p.source_key,
      base: personSlug(p.name, p.source_key),
    })),
  );

  const offices: BOffice[] = [];
  const officePowers: BOfficePower[] = [];
  const officeholders: BOfficeholder[] = [];
  const officeRefs: OfficeRefRow[] = [];
  for (const draft of drafts) {
    const slug = officeSlugs.get(draft.identity);
    if (slug === undefined) {
      continue;
    }
    const ref = OfficeRefRowSchema.parse({
      slug,
      identity: draft.identity,
      origin: 's02-known',
      template_key: null,
      office_type_id: draft.typeId,
      jurisdiction_key: jurisdictionKey,
      jurisdiction_kind: 'state',
      district_key: draft.districtKey,
      county_geoid: null,
      party: null,
      party_selection: null,
      partisan: draft.partisan,
      schedule: draft.schedule,
      track_set: draft.trackSet,
      stagger: [...draft.stagger],
      stagger_group: draft.staggerGroup,
      seats: draft.seats,
      body_size: null,
      term_years: draft.termYears,
      pay_annual_cents: draft.pay.pay_annual_cents,
      pay_range: null,
      template_seats: draft.templateSeats,
      population: draft.population,
    } satisfies OfficeRefRow);
    const next =
      rules !== null && ref.schedule !== null && ref.track_set !== null
        ? nextElecting(contestsInWindow(ref, state, rules, input.today), input.today)
        : null;
    officeRefs.push(ref);
    offices.push(
      BOfficeSchema.parse({
        source_key: slug,
        slug,
        jurisdiction_key: jurisdictionKey,
        district_key: draft.districtKey,
        office_type_id: draft.typeId,
        title: draft.title,
        placeholder: false,
        seats: draft.seats,
        body_size: null,
        seats_up_next: next?.seatsUp ?? null,
        vacant_seats_up_next: null,
        term_years: draft.termYears,
        term_limit_terms: draft.termLimitTerms,
        partisan: draft.partisan,
        party_selection: null,
        electorate: null,
        ...draft.pay,
        pay_change_note: null,
        benefits: null,
        hours_per_week: null,
        full_time: null,
        meeting_times: null,
        fits_day_job: null,
        filing_fee_cents: null,
        signatures_required: null,
        where_to_file: null,
        eligibility: null,
        field_meta: draft.fieldMeta,
      } satisfies BOffice),
    );
    for (const power of draft.powers) {
      officePowers.push(
        BOfficePowerSchema.parse({
          source_key: `${slug}|${power.power_id}`,
          office_key: slug,
          ...power,
        } satisfies BOfficePower),
      );
    }
    if (draft.holders.length > draft.seats) {
      counts.holders_exceed_seats += 1;
    }
    for (const personKey of draft.holders) {
      if (!personSlugs.has(personKey)) {
        continue;
      }
      officeholders.push(
        BOfficeholderSchema.parse({
          source_key: `${slug}|${personKey}|`,
          office_key: slug,
          person_key: personKey,
          seat_label: null,
          since: null,
          until: null,
          seat_up_next: next === null ? null : true,
          term_limited: null,
          not_running: null,
          cash_on_hand_cents: null,
          cash_as_of: null,
          cash_source_url: null,
        } satisfies BOfficeholder),
      );
    }
  }

  const personRows: BPerson[] = [];
  const sourceRows: PersonSourceRow[] = [];
  for (const person of people.values()) {
    const slug = personSlugs.get(person.source_key);
    if (slug === undefined) {
      continue;
    }
    personRows.push(BPersonSchema.parse({ ...person, slug } satisfies BPerson));
    const source = personSources.get(person.source_key);
    if (source !== undefined) {
      sourceRows.push(PersonSourceRowSchema.parse(source));
    }
  }

  return {
    offices: sortBy(offices, (o) => o.source_key),
    officePowers: sortBy(officePowers, (p) => p.source_key),
    people: sortBy(personRows, (p) => p.source_key),
    officeholders: sortBy(officeholders, (h) => h.source_key),
    officeRefs: sortBy(officeRefs, (r) => r.slug),
    personSources: sortBy(sourceRows, (s) => s.person_key),
    counts,
  };
}

const BLOCKING = ['slug_unique', 'openstates_header', 'congress_header', 'dataset_unavailable'];

/** Stage 1's output of a state is missing or holds no state row or state district. */
export class KnownInputMissing extends Error {
  override readonly name = 'KnownInputMissing';
}

function failed(name: string, detail: string): StageResult {
  return { files: [], checks: [{ name, passed: false, detail }], datasets: {} };
}

function countsDetail(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(' ');
}

type ParsedLegislators = Awaited<ReturnType<typeof parseLegislatorsCsv>>;

/** Stage 2's known bodies with the rules modules `deps.rulesFor` gives. */
export function makeS02Known(deps: { rulesFor: (s: string) => StateRules | null }): StageModule {
  let reference: Promise<{ relevance: RelevanceDefaults; parties: PartiesFile }> | null = null;
  const loadReference = () =>
    (reference ??= (async () => ({
      relevance: await loadRelevanceDefaults(repoRoot()),
      parties: await loadParties(),
    }))());
  const parsedLegislators = new WeakMap<RunContext, Promise<ParsedLegislators>>();
  const legislatorsOf = (ctx: RunContext): Promise<ParsedLegislators> => {
    let parsed = parsedLegislators.get(ctx);
    if (parsed === undefined) {
      parsed = loadLegislators(ctx).then(({ text }) => parseLegislatorsCsv(text));
      parsed.catch(() => parsedLegislators.delete(ctx));
      parsedLegislators.set(ctx, parsed);
    }
    return parsed;
  };

  return {
    id: 's02-known',
    milestone: 2,
    blockingChecks: BLOCKING,
    async states(ctx) {
      return (await listStageStates(ctx, 's01-base')).filter((state) => state !== 'US');
    },
    async run(ctx, state, opts): Promise<StageResult> {
      const districts = await loadStageRows(ctx, 's01-base', state, 'districts', BDistrictSchema);
      const jurisdictions = await loadStageRows(
        ctx,
        's01-base',
        state,
        'jurisdictions',
        BJurisdictionSchema,
      );
      const stateRow = jurisdictions?.find((row) => row.source_key === `state:${state}`);
      const stateDistrict = districts?.find((row) => row.source_key.startsWith('tiger:state:'));
      if (districts === null || stateRow === undefined || stateDistrict === undefined) {
        throw new KnownInputMissing(`stage 1 has no complete output for ${state}`);
      }
      const stateFips = stateDistrict.source_key.slice('tiger:state:'.length);
      const template = await readTemplateOutput(ctx, state);

      let openStatesText: string;
      let legislators: ParsedLegislators;
      try {
        openStatesText = (await loadOpenStates(ctx, state)).text;
        legislators = await legislatorsOf(ctx);
      } catch (error) {
        if (error instanceof DatasetUnavailableError) {
          return failed(`dataset_unavailable:${error.dataset}`, error.reason);
        }
        throw error;
      }
      const openStates = await parseOpenStatesCsv(openStatesText);
      if (!openStates.ok) {
        return failed('openstates_header', `missing=${openStates.missing.join(',')}`);
      }
      if (!legislators.ok) {
        return failed('congress_header', `missing=${legislators.missing.join(',')}`);
      }

      const federalMarks = await groundFederalTerms(ctx);
      const { relevance, parties } = await loadReference();
      const failures: string[] = [];
      const assigner =
        (registry: SlugRegistry) =>
        (requests: readonly SlugRequest[]): ReadonlyMap<string, string> => {
          const result = assignSlugs(registry, requests);
          failures.push(...result.failures);
          return result.assigned;
        };
      const checkedAt = ctx.now.toISOString();
      const output = buildKnownBodies({
        state,
        stateFips,
        stateName: stateRow.name,
        today: ctx.today,
        now: ctx.now,
        districts,
        template,
        rules: deps.rulesFor(state),
        openStates: openStates.rows,
        legislators: legislators.rows.filter((member) => member.state === state),
        federalMarks,
        relevanceDefaults: relevance,
        parties,
        assignSlugs: assigner(await loadSlugRegistry(ctx.bucket, 'offices')),
        assignPersonSlugs: assigner(await loadSlugRegistry(ctx.bucket, 'people')),
        openStatesCheckedAt: checkedAt,
        legislatorsCheckedAt: checkedAt,
      });
      if (failures.length > 0) {
        return failed('slug_unique', `failures=${String(failures.length)}`);
      }

      const files = [
        await opts.out.writeRows(S02_KNOWN_FILES.offices, output.offices),
        await opts.out.writeRows(S02_KNOWN_FILES.officePowers, output.officePowers),
        await opts.out.writeRows(S02_KNOWN_FILES.people, output.people),
        await opts.out.writeRows(S02_KNOWN_FILES.officeholders, output.officeholders),
        await opts.out.writeRows(S02_KNOWN_FILES.officeRefs, output.officeRefs),
        await opts.out.writeRows(S02_KNOWN_FILES.personSources, output.personSources),
      ];
      return {
        files,
        checks: [
          { name: 'openstates_header', passed: true, detail: 'missing=' },
          { name: 'congress_header', passed: true, detail: 'missing=' },
          { name: 'slug_unique', passed: true, detail: 'failures=0' },
          {
            name: 'known',
            passed: true,
            detail: countsDetail({
              ...output.counts,
              openstates_rows_dropped: openStates.dropped,
              congress_rows_dropped: legislators.dropped,
            }),
          },
        ],
        datasets: {
          openstates: datasetEntry(ctx, 'openstates', ctx.today),
          'congress-legislators': datasetEntry(ctx, 'congress-legislators', ctx.today),
        },
      };
    },
  };
}

let defaultModule: StageModule | null = null;

function defaultS02(): StageModule {
  defaultModule ??= makeS02Known({ rulesFor });
  return defaultModule;
}

/** Stage 2's known bodies with the registered rules modules; built on first use. */
export const s02Known: StageModule = {
  id: 's02-known',
  milestone: 2,
  blockingChecks: BLOCKING,
  states: (ctx) => defaultS02().states(ctx),
  run: (ctx, state, opts) => defaultS02().run(ctx, state, opts),
};
