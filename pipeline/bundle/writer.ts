// Stage 10, the bundle writer (PIPE-bundle-writer): files, ATTRIBUTION.md and coverage, then the
// manifest, then the pointers. Nothing is written on any stop.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BDistrictFallbackSchema,
  BDistrictSchema,
  BElectionSchema,
  BFilingTrackSchema,
  BGivenNameAliasSchema,
  BJurisdictionSchema,
  BOfficePowerSchema,
  BOfficeSchema,
  BOfficeholderSchema,
  BPersonAliasSchema,
  BPersonSchema,
  BUNDLE_SCHEMA_REVISION,
  BUNDLE_SCHEMA_VERSION,
  BundleManifestSchema,
  BundlePointerSchema,
  LoaderInfoSchema,
} from '@citizenrun/shared';
import type { BGeometry, BundleManifest, BundlePointer } from '@citizenrun/shared';
import { rulesFor as registeredRules } from '@citizenrun/rules';
import type { StateRules } from '@citizenrun/rules';
import type { z } from 'zod';
import { bucketKeys } from '../lib/bucket.ts';
import { loadSources } from '../lib/data-files.ts';
import { repoRoot } from '../lib/paths.ts';
import { runStage as runnerRunStage } from '../lib/runner.ts';
import type { RunContext, StageMeta, StageModule, StageResult } from '../lib/runner.ts';
import { s01Base } from '../stages/s01-base.ts';
import { s02Coops } from '../stages/s02-coops.ts';
import { s02Known } from '../stages/s02-known.ts';
import { s03Templates } from '../stages/s03-templates.ts';
import { s04Expand } from '../stages/s04-expand.ts';
import { s05Deadlines } from '../stages/s05-deadlines.ts';
import { s09People } from '../stages/s09-people.ts';
import { rulesFixtureInfo } from '../stages/shared/rules-fixtures.ts';
import { defaultTemplatesDir, listTemplateFiles } from '../templates/load.ts';
import { FULL_FILES, assemble, combineRows } from './assemble.ts';
import type { AssembledRows, FullFileName } from './assemble.ts';
import { renderBundleAttribution, usedHosts, usedRegisterDatasets } from './attribution.ts';
import {
  copyStage1Checks,
  integrityCheck,
  personalDataCheck,
  updateSlugRegistries,
} from './checks.ts';
import type { ManifestCheck } from './checks.ts';
import { CoverageStatsSchema, coverageStats } from './coverage.ts';
import { encodeFile } from './files.ts';
import { planGeometry } from './geometry.ts';
import { baseStates, readInputs } from './inputs.ts';
import type { BundleInputs } from './inputs.ts';
import { applyPlausibility, deriveFitsDayJob, freshenRows, mergeFacts } from './merge.ts';

export type BundleDeps = {
  /** default: `pnpm --filter @citizenrun/rules test` in the repository root; exit code only, output not logged */
  readonly runRulesFixtures: (root: string) => Promise<{ passed: boolean; detail: string }>;
  /** default: `git rev-parse HEAD`, 40 hex or throw */
  readonly gitSha: (root: string) => Promise<string>;
  readonly runStage: (
    ctx: RunContext,
    stage: StageModule,
    state: string,
    dryRun: boolean,
  ) => Promise<{ readonly failedChecks: readonly string[] }>;
  readonly stages: {
    readonly s03: StageModule;
    readonly s04: StageModule;
    readonly s05: StageModule;
  };
  /** states with a data/templates/<st>.yaml file */
  readonly templateStates: () => Promise<readonly string[]>;
  readonly rulesFor: (state: string) => StateRules | null;
  /** BUNDLE_SCHEMA_REVISION; tests change it */
  readonly writerRevision: number;
};

export type BundleRunResult =
  | {
      readonly status: 'published';
      readonly fullVersion: string | null;
      readonly geometryVersion: string | null;
    }
  | { readonly status: 'unchanged' }
  | {
      readonly status: 'stopped';
      readonly reason: 'rules_fixtures' | 'loader_missing' | 'loader_too_old' | 'checks_failed';
      readonly failed: readonly string[];
    };

const GZIP_TYPE = 'application/gzip';
const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';
const ATTRIBUTION_FILE = 'ATTRIBUTION.md';
const MANIFEST_FILE = 'manifest.json';

const FILE_SCHEMAS: Readonly<Record<FullFileName, z.ZodType>> = {
  jurisdictions: BJurisdictionSchema,
  districts: BDistrictSchema,
  district_fallbacks: BDistrictFallbackSchema,
  offices: BOfficeSchema,
  office_powers: BOfficePowerSchema,
  elections: BElectionSchema,
  filing_tracks: BFilingTrackSchema,
  people: BPersonSchema,
  person_aliases: BPersonAliasSchema,
  officeholders: BOfficeholderSchema,
  given_name_aliases: BGivenNameAliasSchema,
};

const TRACK_ACT_ON = [
  'opens_on',
  'closes_on',
  'closes_time',
  'petition_opens',
  'petition_due',
  'fee_cents',
  'signatures',
  'where_to_file',
] as const;
const OFFICE_ACT_ON = [
  'pay_annual_cents',
  'pay_amount_cents',
  'filing_fee_cents',
  'signatures_required',
  'where_to_file',
] as const;

/** `YYYYMMDDTHHMMSSZ` of `now`, in UTC. */
export function versionStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** The default `runStage`: the runner with run semantics, the failed blocking checks returned. */
export async function runStageForBundle(
  ctx: RunContext,
  stage: StageModule,
  state: string,
  dryRun: boolean,
): Promise<{ readonly failedChecks: readonly string[] }> {
  const seen: { result: StageResult | null; threw: boolean } = { result: null, threw: false };
  const wrapped: StageModule = {
    id: stage.id,
    milestone: stage.milestone,
    blockingChecks: stage.blockingChecks,
    states: (c) => stage.states(c),
    async run(c, st, opts) {
      try {
        seen.result = await stage.run(c, st, opts);
        return seen.result;
      } catch (error) {
        seen.threw = true;
        throw error;
      }
    },
  };
  await runnerRunStage(wrapped, ctx, [state], { dryRun });
  if (seen.threw) return { failedChecks: ['stage_error'] };
  const checks = seen.result?.checks ?? [];
  return {
    failedChecks: checks
      .filter(
        (check) =>
          !check.passed &&
          stage.blockingChecks.some(
            (name) => check.name === name || check.name.startsWith(`${name}:`),
          ),
      )
      .map((check) => check.name),
  };
}

const execFileAsync = promisify(execFile);

/** The repository's default deps: the registered rules, the three stages and the real commands. */
export function defaultBundleDeps(): BundleDeps {
  return {
    runRulesFixtures: (root) =>
      new Promise((resolve) => {
        const child = spawn('pnpm', ['--filter', '@citizenrun/rules', 'test'], {
          cwd: root,
          stdio: 'ignore',
        });
        child.on('error', () => {
          resolve({ passed: false, detail: 'the rules tests did not start' });
        });
        child.on('exit', (code) => {
          resolve({ passed: code === 0, detail: `exit=${String(code)}` });
        });
      }),
    gitSha: async (root) => {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
      const sha = stdout.trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('git rev-parse HEAD gave no commit');
      return sha;
    },
    runStage: runStageForBundle,
    stages: { s03: s03Templates, s04: s04Expand, s05: s05Deadlines },
    templateStates: async () =>
      (await listTemplateFiles(defaultTemplatesDir())).map((file) => file.state),
    rulesFor: registeredRules,
    writerRevision: BUNDLE_SCHEMA_REVISION,
  };
}

type LoaderState = { kind: 'ok' } | { kind: 'missing' } | { kind: 'too_old' };

async function readLoader(ctx: RunContext, writerRevision: number): Promise<LoaderState> {
  const key = bucketKeys.loaderInfo();
  const bytes = await ctx.bucket.getBytes(key);
  if (bytes === null) return { kind: 'missing' };
  let raw: unknown = null;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    raw = null;
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const version = (raw as { schema_version?: unknown }).schema_version;
    if (typeof version === 'number' && version !== BUNDLE_SCHEMA_VERSION) {
      return { kind: 'too_old' };
    }
  }
  // An index file that fails its schema reads as absent (PIPE-bucket-layout).
  const info = LoaderInfoSchema.safeParse(raw);
  if (!info.success) {
    ctx.log.warn('index_file.invalid', { objectKey: key });
    return { kind: 'missing' };
  }
  return info.data.schema_revision < writerRevision ? { kind: 'too_old' } : { kind: 'ok' };
}

async function currentGeometry(ctx: RunContext): Promise<BundleManifest | null> {
  const pointer = await ctx.bucket.readIndexFile(
    bucketKeys.pointer('geometry'),
    BundlePointerSchema,
  );
  if (pointer === null) return null;
  try {
    return await ctx.bucket.getJson(pointer.manifest, BundleManifestSchema);
  } catch {
    return null;
  }
}

type DatasetEntry = BundleManifest['datasets'][string];

function newer(a: DatasetEntry, b: DatasetEntry): boolean {
  if (a.downloaded_on !== b.downloaded_on) return a.downloaded_on > b.downloaded_on;
  if (a.edition !== b.edition) return byteOrder(a.edition, b.edition) > 0;
  return byteOrder(a.source_url, b.source_url) > 0;
}

function unionDatasets(metas: readonly (StageMeta | null)[], only?: ReadonlySet<string>) {
  const out: Record<string, DatasetEntry> = {};
  for (const meta of metas) {
    if (meta === null) continue;
    for (const [id, entry] of Object.entries(meta.datasets)) {
      if (only !== undefined && !only.has(id)) continue;
      const before = out[id];
      if (before === undefined || newer(entry, before)) out[id] = entry;
    }
  }
  const sorted: Record<string, DatasetEntry> = {};
  for (const id of Object.keys(out).sort(byteOrder)) {
    const entry = out[id];
    if (entry !== undefined) sorted[id] = entry;
  }
  return sorted;
}

function stageMetas(inputs: BundleInputs): (StageMeta | null)[] {
  return [
    ...inputs.states.flatMap((s) => [
      s.base.meta,
      s.known.meta,
      s.coops.meta,
      s.templates.meta,
      s.expand.meta,
      s.deadlines.meta,
      s.people.meta,
    ]),
    inputs.zipMeta,
    inputs.givenNameMeta,
  ];
}

function twoSourceFields(rows: AssembledRows): number {
  let count = 0;
  for (const office of rows.offices) {
    for (const field of OFFICE_ACT_ON) {
      if (office[field] !== null && office.field_meta[field]?.confidence === 'high') count += 1;
    }
  }
  for (const track of rows.filing_tracks) {
    for (const field of TRACK_ACT_ON) {
      if (track[field] === null) continue;
      if ((track.field_meta[field]?.confidence ?? track.confidence) === 'high') count += 1;
    }
  }
  return count;
}

function pointer(kind: 'full' | 'geometry', version: string): BundlePointer {
  return {
    kind,
    version,
    manifest: `bundles/${version}/${MANIFEST_FILE}`,
    published_at: new Date().toISOString(),
  };
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Runs stage 10; see PIPE-bundle-writer for the order of its steps. */
export async function runBundle(
  ctx: RunContext,
  opts: {
    readonly kind: 'full' | 'geometry';
    readonly dryRun: boolean;
    readonly states: readonly string[] | 'all';
  },
  deps: BundleDeps,
): Promise<BundleRunResult> {
  const stamp = versionStamp(ctx.now);
  const fullVersion = `${stamp}-full`;
  const newGeometryVersion = `${stamp}-geometry`;
  const root = repoRoot();
  const stop = (
    reason: Extract<BundleRunResult, { status: 'stopped' }>['reason'],
    failed: readonly string[],
  ): BundleRunResult => {
    ctx.log.error('bundle.stopped', { reason, failed: [...failed], failedCount: failed.length });
    return { status: 'stopped', reason, failed };
  };
  const checks: ManifestCheck[] = [];

  // 1. Rules fixtures.
  if (opts.kind === 'full') {
    const rules = await deps.runRulesFixtures(root);
    if (!rules.passed) return stop('rules_fixtures', ['rules_fixtures']);
    checks.push({
      name: 'rules_fixtures',
      passed: true,
      detail: rules.detail === '' ? 'passed' : rules.detail,
    });
  }

  // 2. The deployed loader's revision.
  const loader = await readLoader(ctx, deps.writerRevision);
  if (loader.kind === 'missing') return stop('loader_missing', []);
  if (loader.kind === 'too_old') return stop('loader_too_old', []);

  // 3. Stages 3, 4 and 5 for every state with a template; then the inputs.
  const failed: string[] = [];
  const templateStates = await deps.templateStates();
  if (opts.kind === 'full') {
    const wanted = opts.states === 'all' ? null : new Set(opts.states);
    for (const state of [...templateStates].sort(byteOrder)) {
      if (wanted !== null && !wanted.has(state)) continue;
      const stateFailed = new Set<string>();
      for (const stage of [deps.stages.s03, deps.stages.s04, deps.stages.s05]) {
        const result = await deps.runStage(ctx, stage, state, opts.dryRun);
        for (const name of result.failedChecks) stateFailed.add(`${name}:${state}`);
      }
      failed.push(...stateFailed);
      for (const name of ['template_valid', 'rules_plausible']) {
        if (![...stateFailed].some((f) => f.startsWith(`${name}:`))) {
          checks.push({ name: `${name}:${state}`, passed: true, detail: 'passed' });
        }
      }
    }
  }
  const inputs = await readInputs(ctx, await baseStates(ctx));

  // 4. Assembly, facts, freshness, "keeps a day job?" and plausibility, per state.
  const assembled = assemble(inputs);
  const states = assembled.states.map((state) => {
    const merged = mergeFacts(state.rows, state.facts, state.origins, ctx.now);
    const fresh = freshenRows(merged.rows, state.facts, ctx.now);
    const derived = { ...fresh, offices: fresh.offices.map(deriveFitsDayJob) };
    const plausible = applyPlausibility(derived, assembled.officeRefs, ctx.today);
    const counts: Record<string, number> = { ...state.counts, ...plausible.dropped };
    counts.confidence_conflict = merged.conflicts;
    return { state: state.state, rows: plausible.rows, counts };
  });
  const rows = combineRows(states, assembled.givenNameAliases);

  // 5. Personal data, integrity and stage 1's checks.
  const geometryIndex = new Map<string, BGeometry>();
  for (const list of assembled.geometry.values()) {
    for (const row of list) geometryIndex.set(row.source_key, row);
  }
  const stepChecks = [
    personalDataCheck(rows),
    integrityCheck(rows, geometryIndex),
    ...copyStage1Checks(inputs),
  ];
  const stepFailed = [...failed, ...stepChecks.filter((c) => !c.passed).map((c) => c.name)];
  if (stepFailed.length > 0) return stop('checks_failed', stepFailed);
  checks.push(...stepChecks);

  // 6. Slugs. A geometry bundle publishes no office, so it registers no slug.
  const slugs = await updateSlugRegistries(
    ctx,
    assembled.officeRefs,
    rows.people,
    opts.dryRun || opts.kind === 'geometry',
  );
  if (!slugs.passed) return stop('checks_failed', [slugs.name]);
  checks.push(slugs);

  const sha = await deps.gitSha(root);
  const sources = await loadSources();
  const hosts = usedHosts(rows, inputs.boundarySources);
  const write = async (key: string, body: Uint8Array, type: string) => {
    if (!opts.dryRun) await ctx.bucket.putBytes(key, body, type);
  };

  // 7. Geometry.
  const current = await currentGeometry(ctx);
  const plan = planGeometry(assembled.geometry, assembled.zipCentroids, current);
  let geometryVersion: string | null = current?.version ?? null;
  let geometryWritten = false;
  if (plan.changed) {
    const geometryStates = [...assembled.geometry.keys()].sort(byteOrder);
    const datasets = unionDatasets(
      inputs.states.map((s) => s.base.meta),
      new Set(['tiger', 'cb-state']),
    );
    const vintage = datasets['tiger']?.edition ?? '';
    const manifest = BundleManifestSchema.parse({
      format: 'citizenrun-bundle',
      kind: 'geometry',
      version: newGeometryVersion,
      schema_version: BUNDLE_SCHEMA_VERSION,
      schema_revision: deps.writerRevision,
      created_at: ctx.now.toISOString(),
      git_sha: sha,
      geometry_version: null,
      tiger_vintage: /^\d{4}$/.test(vintage) ? vintage : null,
      states: geometryStates,
      files: plan.files.map(({ name, state, path, sha256, bytes, rows: count }) => ({
        name,
        state,
        path,
        sha256,
        bytes,
        rows: count,
      })),
      assets: [],
      datasets,
      checks: checks.filter((check) => check.name.startsWith('geometry_valid:')),
      filing_sources: [],
      two_source_fields: 0,
      coverage_path: null,
      attribution_path: ATTRIBUTION_FILE,
    });
    for (const file of plan.files) {
      if (file.data !== null) {
        await write(bucketKeys.bundleFile(newGeometryVersion, file.path), file.data, GZIP_TYPE);
      }
    }
    await write(
      bucketKeys.bundleFile(newGeometryVersion, ATTRIBUTION_FILE),
      text(renderBundleAttribution(manifest, sources, hosts)),
      MARKDOWN_TYPE,
    );
    if (!opts.dryRun) {
      await ctx.bucket.putJson(
        bucketKeys.bundleFile(newGeometryVersion, MANIFEST_FILE),
        manifest,
        BundleManifestSchema,
      );
    }
    geometryVersion = newGeometryVersion;
    geometryWritten = true;
  } else if (opts.kind === 'geometry') {
    ctx.log.info('bundle.unchanged', { kind: 'geometry', geometryVersion });
    return { status: 'unchanged' };
  }

  // 8 and 9. The full bundle's files, ATTRIBUTION.md, coverage, then its manifest.
  const fileRows: Record<string, number> = {};
  if (opts.kind === 'full') {
    const files: BundleManifest['files'] = [];
    for (const name of FULL_FILES) {
      const encoded = encodeFile(rows[name] as readonly unknown[], FILE_SCHEMAS[name], name);
      const path = `${name}.ndjson.gz`;
      await write(bucketKeys.bundleFile(fullVersion, path), encoded.bytes, GZIP_TYPE);
      files.push({
        name,
        state: null,
        path,
        sha256: encoded.sha256,
        bytes: encoded.bytes.byteLength,
        rows: encoded.rows,
      });
      fileRows[name] = encoded.rows;
    }
    const rules = new Map<
      string,
      { fixtures: number; passing: boolean; newest_source: string | null } | null
    >();
    for (const state of inputs.states) {
      if (deps.rulesFor(state.state) === null) {
        rules.set(state.state, null);
        continue;
      }
      const info = await rulesFixtureInfo(root, state.state);
      rules.set(state.state, {
        fixtures: info.files,
        passing: true,
        newest_source: info.newestRetrievedOn,
      });
    }
    const coverage = coverageStats({
      version: fullVersion,
      now: ctx.now,
      today: ctx.today,
      inputs,
      states,
      templateStates: new Set(templateStates),
      rules,
      blockingChecks: {
        's01-base': s01Base.blockingChecks,
        's02-known': s02Known.blockingChecks,
        's02-coops': s02Coops.blockingChecks,
        's03-templates': deps.stages.s03.blockingChecks,
        's04-expand': deps.stages.s04.blockingChecks,
        's05-deadlines': deps.stages.s05.blockingChecks,
        's09-people': s09People.blockingChecks,
      },
    });
    const manifest = BundleManifestSchema.parse({
      format: 'citizenrun-bundle',
      kind: 'full',
      version: fullVersion,
      schema_version: BUNDLE_SCHEMA_VERSION,
      schema_revision: deps.writerRevision,
      created_at: ctx.now.toISOString(),
      git_sha: sha,
      geometry_version: geometryVersion,
      tiger_vintage: null,
      states: inputs.states.map((s) => s.state).sort(byteOrder),
      files,
      assets: assembled.assets.map((asset) => ({
        path: `../../${asset.path}`,
        sha256: asset.sha256,
        kind: 'photo',
        bytes: asset.bytes,
        content_type: 'image/jpeg',
      })),
      datasets: unionDatasets(stageMetas(inputs)),
      checks,
      filing_sources: [],
      two_source_fields: twoSourceFields(rows),
      coverage_path: `../../${bucketKeys.coverage(fullVersion)}`,
      attribution_path: ATTRIBUTION_FILE,
    });
    await write(
      bucketKeys.bundleFile(fullVersion, ATTRIBUTION_FILE),
      text(renderBundleAttribution(manifest, sources, hosts, usedRegisterDatasets(rows))),
      MARKDOWN_TYPE,
    );
    if (!opts.dryRun) {
      await ctx.bucket.putJson(bucketKeys.coverage(fullVersion), coverage, CoverageStatsSchema);
      await ctx.bucket.putJson(
        bucketKeys.bundleFile(fullVersion, MANIFEST_FILE),
        manifest,
        BundleManifestSchema,
      );
    }
  }

  // 10. Pointers last: geometry first, then full.
  if (!opts.dryRun) {
    if (geometryWritten && geometryVersion !== null) {
      await ctx.bucket.putJson(
        bucketKeys.pointer('geometry'),
        pointer('geometry', geometryVersion),
        BundlePointerSchema,
      );
    }
    if (opts.kind === 'full') {
      await ctx.bucket.putJson(
        bucketKeys.pointer('full'),
        pointer('full', fullVersion),
        BundlePointerSchema,
      );
    }
  }
  const published = {
    status: 'published' as const,
    fullVersion: opts.kind === 'full' ? fullVersion : null,
    geometryVersion: geometryWritten ? geometryVersion : null,
  };
  ctx.log.info('bundle.published', {
    fullVersion: published.fullVersion,
    geometryVersion: published.geometryVersion,
    fileRows,
    assets: assembled.assets.length,
    dryRun: opts.dryRun,
  });
  return published;
}
