// Step 2 of the bundle writer: each bundle file's rows from the stages that own them.
import type {
  BDistrict,
  BDistrictFallback,
  BElection,
  BFilingTrack,
  BGeometry,
  BGivenNameAlias,
  BJurisdiction,
  BOffice,
  BOfficePower,
  BOfficeholder,
  BPerson,
  BPersonAlias,
  BZipCentroid,
} from '@citizenrun/shared';
import type { Fact } from '../lib/facts.ts';
import type { StageId, StageMeta } from '../lib/runner.ts';
import type { OfficeRefRow } from '../stages/shared/office-ref.ts';
import type { AssetRow, BundleInputs, StateInputs } from './inputs.ts';

/** The rows of the eleven files of revision 0. */
export type AssembledRows = {
  jurisdictions: BJurisdiction[];
  districts: BDistrict[];
  district_fallbacks: BDistrictFallback[];
  offices: BOffice[];
  office_powers: BOfficePower[];
  elections: BElection[];
  filing_tracks: BFilingTrack[];
  people: BPerson[];
  person_aliases: BPersonAlias[];
  officeholders: BOfficeholder[];
  given_name_aliases: BGivenNameAlias[];
};

/** The bundle files in the order of 3.1. */
export const FULL_FILES = [
  'jurisdictions',
  'districts',
  'district_fallbacks',
  'offices',
  'office_powers',
  'elections',
  'filing_tracks',
  'people',
  'person_aliases',
  'officeholders',
  'given_name_aliases',
] as const satisfies readonly (keyof AssembledRows)[];
export type FullFileName = (typeof FULL_FILES)[number];

/** The stage that wrote a row and when it finished, keyed `<table>|<source_key>`. */
export type OriginIndex = ReadonlyMap<
  string,
  { readonly origin: StageId; readonly finishedAt: string }
>;

export type AssembledState = {
  readonly state: string;
  readonly rows: AssembledRows;
  /** The facts whose rows exist in the state's rows. */
  readonly facts: readonly Fact[];
  readonly origins: OriginIndex;
  /** This step's counts for the coverage stats (`holder_office_missing`, `fact_row_missing`). */
  readonly counts: Readonly<Record<string, number>>;
};

export type Assembled = {
  readonly states: readonly AssembledState[];
  readonly givenNameAliases: readonly BGivenNameAlias[];
  /** Every geometry row of each state: stage 1, co-ops and stage 4. */
  readonly geometry: ReadonlyMap<string, readonly BGeometry[]>;
  readonly zipCentroids: readonly BZipCentroid[];
  /** Every stage's office refs, keyed by slug. */
  readonly officeRefs: ReadonlyMap<string, OfficeRefRow>;
  /** Stage 9's asset rows that a kept person's photo names, by path, in byte order. */
  readonly assets: readonly AssetRow[];
};

export function emptyRows(): AssembledRows {
  return {
    jurisdictions: [],
    districts: [],
    district_fallbacks: [],
    offices: [],
    office_powers: [],
    elections: [],
    filing_tracks: [],
    people: [],
    person_aliases: [],
    officeholders: [],
    given_name_aliases: [],
  };
}

/** Every state's rows in one set, with the national given-name aliases. */
export function combineRows(
  states: readonly { readonly rows: AssembledRows }[],
  givenNameAliases: readonly BGivenNameAlias[] = [],
): AssembledRows {
  const out = emptyRows();
  for (const { rows } of states) {
    for (const file of FULL_FILES) {
      (out[file] as unknown[]).push(...rows[file]);
    }
  }
  out.given_name_aliases.push(...givenNameAliases);
  return out;
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

type Origins = Map<string, { origin: StageId; finishedAt: string }>;

function record<T extends { source_key: string }>(
  origins: Origins,
  table: string,
  rows: readonly T[],
  origin: StageId,
  meta: StageMeta | null,
): T[] {
  if (meta !== null) {
    for (const row of rows) {
      origins.set(`${table}|${row.source_key}`, { origin, finishedAt: meta.finished_at });
    }
  }
  return [...rows];
}

function assembleState(input: StateInputs): {
  state: AssembledState;
  geometry: BGeometry[];
  refs: OfficeRefRow[];
  assets: AssetRow[];
} {
  const origins: Origins = new Map();
  const counts = { holder_office_missing: 0, fact_row_missing: 0 };
  const { base, known, coops, expand, deadlines, people: s09 } = input;
  const rows = emptyRows();

  rows.jurisdictions = [
    ...record(origins, 'jurisdictions', base.jurisdictions, 's01-base', base.meta),
    ...record(origins, 'jurisdictions', coops.jurisdictions, 's02-coops', coops.meta),
    ...record(origins, 'jurisdictions', expand.jurisdictions, 's04-expand', expand.meta),
  ];
  rows.districts = [
    ...record(origins, 'districts', base.districts, 's01-base', base.meta),
    ...record(origins, 'districts', coops.districts, 's02-coops', coops.meta),
    ...record(origins, 'districts', expand.districts, 's04-expand', expand.meta),
  ];
  rows.district_fallbacks = [
    ...base.district_fallbacks,
    ...coops.district_fallbacks,
    ...expand.district_fallbacks,
  ];
  rows.offices = [
    ...record(origins, 'offices', known.offices, 's02-known', known.meta),
    ...record(origins, 'offices', coops.offices, 's02-coops', coops.meta),
    ...record(origins, 'offices', expand.offices, 's04-expand', expand.meta),
  ];
  rows.office_powers = [...known.office_powers, ...coops.office_powers, ...expand.office_powers];
  rows.elections = record(origins, 'elections', expand.elections, 's04-expand', expand.meta);
  rows.filing_tracks = record(
    origins,
    'filing_tracks',
    deadlines.filing_tracks,
    's05-deadlines',
    deadlines.meta,
  );

  // People: stage 2's people, plus stage 9's statewide people a kept stage 9 holder names.
  const officeKeys = new Set(rows.offices.map((office) => office.source_key));
  const keptHolders = s09.officeholders.filter((holder) => officeKeys.has(holder.office_key));
  counts.holder_office_missing = s09.officeholders.length - keptHolders.length;
  const stage2People = [...known.people, ...coops.people];
  const members = new Set([
    ...stage2People.map((person) => person.source_key),
    ...keptHolders.map((holder) => holder.person_key),
  ]);
  const stage9People = new Map(
    s09.people
      .filter((person) => members.has(person.source_key))
      .map((person) => [person.source_key, person]),
  );
  rows.people = [
    ...stage2People.map((person) => stage9People.get(person.source_key) ?? person),
    ...[...stage9People.values()].filter(
      (person) => !stage2People.some((other) => other.source_key === person.source_key),
    ),
  ];
  rows.person_aliases = s09.person_aliases.filter((alias) => members.has(alias.person_key));
  rows.officeholders = [...known.officeholders, ...coops.officeholders, ...keptHolders];

  // Facts whose row is in the state's rows; the rest are counted and dropped.
  const keys = new Set<string>();
  for (const table of [
    'jurisdictions',
    'districts',
    'offices',
    'elections',
    'filing_tracks',
  ] as const) {
    for (const row of rows[table]) {
      keys.add(`${table}|${row.source_key}`);
    }
  }
  for (const holder of rows.officeholders) keys.add(`officeholders|${holder.source_key}`);
  for (const power of rows.office_powers) keys.add(`office_powers|${power.source_key}`);
  const facts: Fact[] = [];
  for (const fact of [...coops.facts, ...deadlines.facts]) {
    if (keys.has(`${fact.table}|${fact.key}`)) {
      facts.push(fact);
    } else {
      counts.fact_row_missing += 1;
    }
  }

  const photos = new Set(
    rows.people.flatMap((person) => (person.photo === null ? [] : [person.photo.asset])),
  );
  return {
    state: { state: input.state, rows, facts, origins, counts },
    geometry: [...base.geometry, ...coops.geometry, ...expand.geometry],
    refs: [...known.office_refs, ...coops.office_refs, ...expand.office_refs],
    assets: s09.assets.filter((asset) => photos.has(`../../${asset.path}`)),
  };
}

/** Builds every state's rows from its stage outputs; duplicate keys are kept for the integrity check. */
export function assemble(inputs: BundleInputs): Assembled {
  const states: AssembledState[] = [];
  const geometry = new Map<string, readonly BGeometry[]>();
  const officeRefs = new Map<string, OfficeRefRow>();
  const assets = new Map<string, AssetRow>();
  for (const input of inputs.states) {
    const built = assembleState(input);
    states.push(built.state);
    geometry.set(input.state, built.geometry);
    for (const ref of built.refs) {
      officeRefs.set(ref.slug, ref);
    }
    for (const asset of built.assets) {
      assets.set(asset.path, asset);
    }
  }
  return {
    states,
    givenNameAliases: [...inputs.givenNameAliases],
    geometry,
    zipCentroids: [...inputs.zipCentroids],
    officeRefs,
    assets: [...assets.keys()].sort(byteOrder).flatMap((path) => {
      const asset = assets.get(path);
      return asset === undefined ? [] : [asset];
    }),
  };
}
