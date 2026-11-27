// Steps 5 to 8 of the bundle writer: the blocking checks. A detail names files, kinds, counts and
// keys, never a matched value.
import { looksPersonal } from '@citizenrun/shared';
import type { BGeometry, BPerson } from '@citizenrun/shared';
import { loadSlugRegistry, saveSlugRegistry } from '../lib/slug.ts';
import type { RunContext } from '../lib/runner.ts';
import type { OfficeRefRow } from '../stages/shared/office-ref.ts';
import { FULL_FILES } from './assemble.ts';
import type { AssembledRows } from './assemble.ts';
import type { BundleInputs } from './inputs.ts';

export type CheckResult = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};
export type ManifestCheck = CheckResult;

const DETAIL_MAX = 2000;
const FIRST = 5;

function cut(detail: string): string {
  const text = detail === '' ? 'none' : detail;
  return text.length <= DETAIL_MAX ? text : `${text.slice(0, DETAIL_MAX - 3)}...`;
}

function strings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) strings(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) strings(item, out);
  }
}

/**
 * D-084: no address, post office box, phone number or email in any string of a person, alias or
 * officeholder row, nested ones included. `where_to_file` is on offices and tracks and is not scanned.
 */
export function personalDataCheck(
  rows: Pick<AssembledRows, 'people' | 'person_aliases' | 'officeholders'>,
): CheckResult {
  const matches: string[] = [];
  for (const file of ['people', 'person_aliases', 'officeholders'] as const) {
    for (const row of rows[file]) {
      const found: string[] = [];
      strings(row, found);
      if (found.some((text) => looksPersonal(text))) {
        matches.push(`${file}:${row.source_key}`);
      }
    }
  }
  return {
    name: 'personal_data',
    passed: matches.length === 0,
    detail: cut(
      matches.length === 0
        ? 'matches=0'
        : `matches=${String(matches.length)} first: ${matches.slice(0, FIRST).join(', ')}`,
    ),
  };
}

class Failures {
  private readonly kinds = new Map<string, string[]>();

  add(kind: string, key: string): void {
    const list = this.kinds.get(kind) ?? [];
    list.push(key);
    this.kinds.set(kind, list);
  }

  get size(): number {
    return this.kinds.size;
  }

  detail(): string {
    if (this.kinds.size === 0) return 'failures=0';
    return [...this.kinds.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([kind, keys]) => `${kind}=${String(keys.length)} (${keys.slice(0, FIRST).join(', ')})`)
      .join('; ');
  }
}

/**
 * Every key resolves to a row of the bundle, every fallback runs through an exact district, every
 * district has a geometry row with its `geom_hash` and the WKB its quality calls for, and no
 * `source_key` repeats within a file.
 */
export function integrityCheck(
  rows: AssembledRows,
  geometry: ReadonlyMap<string, BGeometry>,
): CheckResult {
  const failures = new Failures();
  const keys = (list: readonly { source_key: string }[]) => new Set(list.map((r) => r.source_key));
  const jurisdictions = keys(rows.jurisdictions);
  const districts = new Map(rows.districts.map((d) => [d.source_key, d]));
  const offices = keys(rows.offices);
  const elections = keys(rows.elections);
  const people = keys(rows.people);
  const need = (
    kind: string,
    value: string | null,
    set: { has(key: string): boolean },
    key: string,
  ) => {
    if (value !== null && !set.has(value)) failures.add(kind, key);
  };
  for (const row of rows.jurisdictions)
    need('jurisdictions.parent_key', row.parent_key, jurisdictions, row.source_key);
  for (const row of rows.districts)
    need('districts.jurisdiction_key', row.jurisdiction_key, jurisdictions, row.source_key);
  for (const row of rows.district_fallbacks) {
    need('district_fallbacks.district_key', row.district_key, districts, row.source_key);
    need('district_fallbacks.via_district_key', row.via_district_key, districts, row.source_key);
    const via = districts.get(row.via_district_key);
    if (via !== undefined && via.geometry_quality !== 'exact') {
      failures.add('district_fallbacks.via_not_exact', row.source_key);
    }
  }
  for (const row of rows.offices) {
    need('offices.jurisdiction_key', row.jurisdiction_key, jurisdictions, row.source_key);
    need('offices.district_key', row.district_key, districts, row.source_key);
  }
  for (const row of rows.office_powers)
    need('office_powers.office_key', row.office_key, offices, row.source_key);
  for (const row of rows.elections)
    need('elections.office_key', row.office_key, offices, row.source_key);
  for (const row of rows.filing_tracks)
    need('filing_tracks.election_key', row.election_key, elections, row.source_key);
  for (const row of rows.officeholders) {
    need('officeholders.office_key', row.office_key, offices, row.source_key);
    need('officeholders.person_key', row.person_key, people, row.source_key);
  }
  for (const row of rows.person_aliases)
    need('person_aliases.person_key', row.person_key, people, row.source_key);
  for (const district of rows.districts) {
    const shape = geometry.get(district.source_key);
    if (shape === undefined) {
      failures.add('geometry.missing', district.source_key);
      continue;
    }
    if (shape.geom_hash !== district.geom_hash) {
      failures.add('geometry.geom_hash', district.source_key);
    }
    const hasWkb = shape.lookup_wkb !== null && shape.display_wkb !== null;
    const anyWkb = shape.lookup_wkb !== null || shape.display_wkb !== null;
    if (district.geometry_quality === 'exact' ? !hasWkb : anyWkb) {
      failures.add('geometry.wkb', district.source_key);
    }
  }
  for (const file of FULL_FILES) {
    const seen = new Set<string>();
    for (const row of rows[file]) {
      if (seen.has(row.source_key)) failures.add(`duplicate.${file}`, row.source_key);
      seen.add(row.source_key);
    }
  }
  return {
    name: 'referential_integrity',
    passed: failures.size === 0,
    detail: cut(failures.detail()),
  };
}

function matches(name: string, check: string): boolean {
  return name === check || name.startsWith(`${check}:`);
}

/**
 * Stage 1's checks for the manifest: for each state of the bundle, the newer of its `_meta.json`
 * and its newest failure record decides; `listing_header`, `unit_counts` and `join_rate` pass when
 * every such state's newest result passed, and each gets `geometry_valid:<ST>`. A state with no
 * complete output is left out of the bundle and listed in the coverage's `missing_states`, so its
 * failure does not stop the bundle.
 */
export function copyStage1Checks(inputs: BundleInputs): readonly ManifestCheck[] {
  const failing = new Map<string, readonly string[]>();
  for (const state of inputs.states) {
    const { meta, failure } = state.base;
    failing.set(
      state.state,
      failure !== null && failure.finishedAt > meta.finished_at
        ? failure.failedChecks
        : meta.checks.filter((check) => !check.passed).map((check) => check.name),
    );
  }
  const states = [...failing.keys()].sort();
  const national = ['listing_header', 'unit_counts', 'join_rate'].map((name): ManifestCheck => {
    const bad = states.filter((state) => (failing.get(state) ?? []).some((n) => matches(n, name)));
    return {
      name,
      passed: bad.length === 0,
      detail: cut(`states=${String(states.length)} failing=${bad.join(',')}`),
    };
  });
  const geometry = inputs.states.map((state): ManifestCheck => {
    const bad = (failing.get(state.state) ?? []).some((n) => matches(n, 'geometry_valid'));
    return {
      name: `geometry_valid:${state.state}`,
      passed: !bad,
      detail: bad ? 'the newest stage 1 run failed geometry_valid' : 'passed',
    };
  });
  return [...national, ...geometry];
}

/**
 * PIPE-slugs, step 8: a registered identity keeps its slug, and a new identity's slug is held by no
 * registry entry (retired ones included) and by no other identity of the bundle; people by
 * `source_key` the same way. On a pass, and unless `dryRun`, both registries are written.
 */
export async function updateSlugRegistries(
  ctx: RunContext,
  refs: ReadonlyMap<string, OfficeRefRow>,
  people: readonly BPerson[],
  dryRun: boolean,
): Promise<CheckResult> {
  const collisions = new Set<string>();
  const check = (
    registry: ReadonlyMap<string, string>,
    wanted: readonly { identity: string; slug: string }[],
  ): Map<string, string> => {
    const next = new Map(registry);
    const held = new Map<string, string>();
    for (const [identity, slug] of registry) held.set(slug, identity);
    for (const { identity, slug } of wanted) {
      const registered = registry.get(identity);
      if (registered !== undefined) {
        if (registered !== slug) collisions.add(slug);
        continue;
      }
      const holder = held.get(slug);
      if (holder !== undefined && holder !== identity) {
        collisions.add(slug);
        continue;
      }
      held.set(slug, identity);
      next.set(identity, slug);
    }
    return next;
  };
  const offices = check(
    await loadSlugRegistry(ctx.bucket, 'offices'),
    [...refs.values()].map((ref) => ({ identity: ref.identity, slug: ref.slug })),
  );
  const persons = check(
    await loadSlugRegistry(ctx.bucket, 'people'),
    people.map((person) => ({ identity: person.source_key, slug: person.slug })),
  );
  if (collisions.size > 0) {
    return {
      name: 'slug_unique',
      passed: false,
      detail: cut(
        `collisions=${String(collisions.size)} first: ${[...collisions].sort().slice(0, FIRST).join(', ')}`,
      ),
    };
  }
  if (!dryRun) {
    await saveSlugRegistry(ctx.bucket, 'offices', offices);
    await saveSlugRegistry(ctx.bucket, 'people', persons);
  }
  return { name: 'slug_unique', passed: true, detail: 'collisions=0' };
}
