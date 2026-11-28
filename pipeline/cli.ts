// The pipeline's command line: pnpm run pipeline <command> [--state <ST,ST|all>] [--dry-run]
// [--plan-out <path>]. The only file of the package that writes to the console.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rulesFor } from '@citizenrun/rules';
import { createLogger } from '@citizenrun/shared';
import type { LogLevel, Logger } from '@citizenrun/shared';
import { z } from 'zod';
import { defaultBundleDeps, runBundle } from './bundle/writer.ts';
import type { BundleDeps, BundleRunResult } from './bundle/writer.ts';
import {
  SAMPLE_COUNTIES,
  SAMPLE_MAX_BYTES,
  SAMPLE_STATES,
  SampleSourceMissing,
  SampleTooLarge,
  buildSample,
} from './bundle/sample.ts';
import type { SampleOptions, SampleResult } from './bundle/sample.ts';
import { runSnapshots, snapshotsExitCode } from './crawlers/archiver.ts';
import { EnvError, loadEnv } from './env.ts';
import type { PipelineEnv } from './env.ts';
import { parseArgs, UsageError } from './lib/args.ts';
import type { ParsedArgs } from './lib/args.ts';
import { bucketKeys, createDataBucket, dataBucketConfig } from './lib/bucket.ts';
import type { DataBucket } from './lib/bucket.ts';
import { hasMarker, loadSnapshotSources, loadSources, sourceHostRules } from './lib/data-files.ts';
import type { SnapshotSource } from './lib/data-files.ts';
import { openBrowserSession } from './lib/fetch/browser.ts';
import type { BrowserSession } from './lib/fetch/browser.ts';
import { systemClock } from './lib/fetch/clock.ts';
import { createFetcher } from './lib/fetch/fetcher.ts';
import type { PipelineFetcher } from './lib/fetch/fetcher.ts';
import { fetchStateDir } from './lib/fetch/host-lock.ts';
import { nodeTransport } from './lib/fetch/transport.ts';
import { userAgent } from './lib/fetch/user-agent.ts';
import { HOME_COPY_SOURCE, HomeCopyError, assertRemoteTarget, homeCopy } from './lib/home-copy.ts';
import { housekeeping } from './lib/housekeeping.ts';
import { runLocalFetch } from './lib/local-fetch.ts';
import { repoRoot } from './lib/paths.ts';
import { ReachabilityReportSchema, probeReachability } from './lib/reachability.ts';
import type { ReachabilityTarget } from './lib/reachability.ts';
import { NO_FETCHER, createRunContext, runStage } from './lib/runner.ts';
import type { RunContext, StageModule } from './lib/runner.ts';
import { loadTimezoneRegister, zoneForState } from './lib/timezones.ts';
import { seedDataset } from './stages/base/datasets-seed.ts';
import { s01Base } from './stages/s01-base.ts';
import { s02Coops } from './stages/s02-coops.ts';
import { s02Known } from './stages/s02-known.ts';
import { checkTemplates, s03Templates } from './stages/s03-templates.ts';
import type { S03Deps } from './stages/s03-templates.ts';
import { s04Expand } from './stages/s04-expand.ts';
import { s05Deadlines } from './stages/s05-deadlines.ts';
import { s09People } from './stages/s09-people.ts';
import { loadReferenceIds } from './stages/shared/reference.ts';
import { defaultTemplatesDir } from './templates/load.ts';

/** The commands that run one stage module over states, each with `--plan-out`. */
export type StageCommandName =
  'base' | 'known' | 'coops' | 'templates' | 'expand' | 'deadlines' | 'people';

export type BundleOptions = Parameters<typeof runBundle>[1];

/** What the command line is built from; tests replace any part. */
export type CliDeps = {
  readonly stages: Readonly<Record<StageCommandName, StageModule>>;
  /** `templates --check`: the folder, the rules modules and the reference ids it validates with. */
  readonly templates: S03Deps;
  readonly runBundle: (
    ctx: RunContext,
    opts: BundleOptions,
    deps: BundleDeps,
  ) => Promise<BundleRunResult>;
  readonly bundleDeps: () => BundleDeps;
  /** `sample-bundle`: the builder of B-sample. */
  readonly buildSample: (ctx: RunContext, opts: SampleOptions) => Promise<SampleResult>;
  readonly loadEnv: (log: Logger) => PipelineEnv;
  readonly makeLogger: (level: LogLevel) => Logger;
  /** The fetcher of a command that makes requests; null only in tests that make none. */
  readonly makeFetcher: (
    env: PipelineEnv,
    bucket: DataBucket,
    log: Logger,
  ) => Promise<PipelineFetcher | null>;
};

type Command = {
  name: string;
  /** The command's line in `--help`: its name and options. */
  usage: string;
  needsFetcher: (args: ParsedArgs) => boolean;
  /** `fetcher` is the PipelineFetcher of a command that needs one (the same object as ctx.fetcher), else null. */
  run(ctx: RunContext, args: ParsedArgs, fetcher: PipelineFetcher | null): Promise<number>;
};

function requireFetcher(fetcher: PipelineFetcher | null): PipelineFetcher {
  if (fetcher === null) {
    throw new Error('this command needs the fetcher');
  }
  return fetcher;
}

/** A browser session opened on first use, with the fetcher the command received; closed by `close`. */
function lazyBrowser(
  fetcher: PipelineFetcher,
  log: Logger,
): { open: () => Promise<BrowserSession>; close: () => Promise<void> } {
  let opened: Promise<BrowserSession> | null = null;
  return {
    open() {
      opened ??= openBrowserSession(fetcher, log);
      return opened;
    },
    async close() {
      if (opened === null) {
        return;
      }
      try {
        await (await opened).close();
      } catch {
        // A session that failed to open has nothing to close.
      }
    },
  };
}

/** The URL a reachability probe checks for an entry (PIPE-reachability "Targets"). */
function reachabilityTarget(entry: SnapshotSource): ReachabilityTarget {
  const { recipe } = entry;
  const base = { state: entry.state, source: entry.source, kind: recipe.kind };
  switch (recipe.kind) {
    case 'get':
      return { ...base, url: recipe.url, linkPattern: null };
    case 'discover_get':
      return { ...base, url: recipe.page, linkPattern: recipe.link_pattern };
    case 'playwright_export':
      return { ...base, url: recipe.election_ids_from ?? recipe.url, linkPattern: null };
  }
}

/** The recipe value a marker entry would be checked at, which is itself still a marker. */
function markerTarget(entry: SnapshotSource): string {
  const { recipe } = entry;
  switch (recipe.kind) {
    case 'get':
      return recipe.url;
    case 'discover_get':
      return recipe.page;
    case 'playwright_export':
      return recipe.election_ids_from ?? recipe.url;
  }
}

const PackageVersionSchema = z.object({ version: z.string().min(1).max(64) });

/** The pipeline package's version, which the user agent carries. */
function pipelineVersion(): string {
  const raw: unknown = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'));
  return PackageVersionSchema.parse(raw).version;
}

const SEED_LINE = 'datasets seed --dataset <id> --edition <e> --file <path> --source-url <url>';
const SEED_USAGE = `usage: pnpm run pipeline ${SEED_LINE}`;
const SEED_FLAGS: ReadonlySet<string> = new Set(['dataset', 'edition', 'file', 'source-url']);
const PLAN_OUT = 'plan-out';

/** A stage command: the module over `--state`, or with `--plan-out` only the states it would run. */
function stageCommand(opts: {
  name: StageCommandName;
  states: string;
  needsFetcher: boolean;
  module: StageModule;
}): Command {
  const usage = `${opts.name} [--state <${opts.states}>] [--dry-run] [--plan-out <path>]`;
  return {
    name: opts.name,
    usage,
    needsFetcher: (args) => opts.needsFetcher && !args.flags.has(PLAN_OUT),
    async run(ctx, args) {
      if ([...args.flags.keys()].some((flag) => flag !== PLAN_OUT)) {
        console.error(`usage: pnpm run pipeline ${usage}`);
        return 2;
      }
      const planOut = args.flags.get(PLAN_OUT);
      if (planOut !== undefined) {
        const all = await opts.module.states(ctx);
        const wanted = args.states;
        const states =
          wanted === null || wanted === 'all' ? all : all.filter((code) => wanted.includes(code));
        writeFileSync(planOut, `${JSON.stringify({ states })}\n`);
        return 0;
      }
      const { exitCode, summaries } = await runStage(opts.module, ctx, args.states ?? 'all', {
        dryRun: args.dryRun,
      });
      if (args.dryRun) {
        for (const summary of summaries) {
          const files = summary.files.map((file) => `${file.name} ${String(file.rows)}`).join(', ');
          console.log(`dry run ${summary.state}: ${summary.status}; ${files}`);
        }
      }
      return exitCode;
    },
  };
}

const BUNDLE_USAGE = 'bundle [--kind full|geometry] [--state <ST,ST|all>] [--dry-run]';

function bundleCommand(deps: CliDeps): Command {
  return {
    name: 'bundle',
    usage: BUNDLE_USAGE,
    // stage 3 grounds its quotes through the fetcher
    needsFetcher: () => true,
    async run(ctx, args) {
      const kind = args.flags.get('kind') ?? 'full';
      if (
        [...args.flags.keys()].some((flag) => flag !== 'kind') ||
        (kind !== 'full' && kind !== 'geometry')
      ) {
        console.error(`usage: pnpm run pipeline ${BUNDLE_USAGE}`);
        return 2;
      }
      const result = await deps.runBundle(
        ctx,
        { kind, dryRun: args.dryRun, states: args.states ?? 'all' },
        deps.bundleDeps(),
      );
      ctx.log.info('bundle.result', {
        kind,
        dryRun: args.dryRun,
        status: result.status,
        fullVersion: result.status === 'published' ? result.fullVersion : null,
        geometryVersion: result.status === 'published' ? result.geometryVersion : null,
        reason: result.status === 'stopped' ? result.reason : null,
        failed: result.status === 'stopped' ? [...result.failed] : [],
      });
      return result.status === 'stopped' ? 1 : 0;
    },
  };
}

const SAMPLE_USAGE = 'sample-bundle --out <dir>';

/**
 * `sample-bundle --out <dir>`: B-sample's builder over the pipeline's home. A relative `--out` is
 * resolved against the repository root. Exit 1 when the folder is too large or the source missing.
 */
function sampleCommand(deps: CliDeps): Command {
  return {
    name: 'sample-bundle',
    usage: SAMPLE_USAGE,
    needsFetcher: () => false,
    async run(ctx, args) {
      const out = args.flags.get('out');
      if (
        out === undefined ||
        out === '' ||
        args.states !== null ||
        args.dryRun ||
        [...args.flags.keys()].some((flag) => flag !== 'out')
      ) {
        console.error(`usage: pnpm run pipeline ${SAMPLE_USAGE}`);
        return 2;
      }
      const root = repoRoot();
      try {
        const result = await deps.buildSample(ctx, {
          outDir: isAbsolute(out) ? out : resolve(root, out),
          counties: SAMPLE_COUNTIES,
          states: SAMPLE_STATES,
          maxBytes: SAMPLE_MAX_BYTES,
          now: ctx.now,
          gitSha: await deps.bundleDeps().gitSha(root),
        });
        ctx.log.info('sample.result', {
          status: 'built',
          fullVersion: result.fullVersion,
          geometryVersion: result.geometryVersion,
          bytes: result.bytes,
          photos: result.photos,
          stateGeometryReplaced: result.stateGeometryReplaced,
        });
        return 0;
      } catch (error) {
        if (error instanceof SampleTooLarge) {
          ctx.log.error('sample.result', { status: 'too_large', bytes: error.bytes });
          return 1;
        }
        if (error instanceof SampleSourceMissing) {
          ctx.log.error('sample.result', { status: 'source_missing', reason: error.message });
          return 1;
        }
        throw error;
      }
    },
  };
}

function buildCommands(deps: CliDeps): readonly Command[] {
  const { stages } = deps;
  return [
    stageCommand({ name: 'base', states: 'ST,ST|all|US', needsFetcher: true, module: stages.base }),
    stageCommand({ name: 'known', states: 'ST,ST|all', needsFetcher: true, module: stages.known }),
    stageCommand({ name: 'coops', states: 'ST,ST|all', needsFetcher: true, module: stages.coops }),
    stageCommand({
      name: 'templates',
      states: 'ST,ST|all',
      needsFetcher: true,
      module: stages.templates,
    }),
    stageCommand({
      name: 'expand',
      states: 'ST,ST|all',
      needsFetcher: false,
      module: stages.expand,
    }),
    stageCommand({
      name: 'deadlines',
      states: 'ST,ST|all',
      needsFetcher: false,
      module: stages.deadlines,
    }),
    stageCommand({
      name: 'people',
      states: 'ST,ST|all|US',
      needsFetcher: true,
      module: stages.people,
    }),
    bundleCommand(deps),
    sampleCommand(deps),
    {
      name: 'datasets seed',
      usage: SEED_LINE,
      needsFetcher: () => false,
      async run(ctx, args) {
        const flag = (name: string) => args.flags.get(name);
        const dataset = flag('dataset');
        const edition = flag('edition');
        const file = flag('file');
        const sourceUrl = flag('source-url');
        if (
          args.states !== null ||
          [...args.flags.keys()].some((name) => !SEED_FLAGS.has(name)) ||
          dataset === undefined ||
          edition === undefined ||
          file === undefined ||
          sourceUrl === undefined
        ) {
          console.error(SEED_USAGE);
          return 2;
        }
        const outcome = await seedDataset(ctx, { dataset, edition, file, sourceUrl });
        if (outcome.exitCode === 2) {
          console.error(outcome.usage);
          console.error(SEED_USAGE);
          return 2;
        }
        console.log(
          `seeded ${outcome.key}: ${String(outcome.bytes)} bytes, sha256 ${outcome.sha256}`,
        );
        return 0;
      },
    },
    {
      name: 'housekeeping',
      usage: 'housekeeping [--dry-run]',
      needsFetcher: () => false,
      async run(ctx) {
        await housekeeping(ctx.bucket, ctx.now, ctx.log);
        return 0;
      },
    },
    {
      name: 'home-copy',
      usage: 'home-copy [--dry-run]',
      needsFetcher: () => false,
      async run(ctx, args) {
        try {
          assertRemoteTarget(HOME_COPY_SOURCE, dataBucketConfig(ctx.env));
          const source = createDataBucket(HOME_COPY_SOURCE, { dryRun: args.dryRun, log: ctx.log });
          await homeCopy(source, ctx.bucket, { dryRun: args.dryRun, log: ctx.log });
          return 0;
        } catch (error) {
          if (!(error instanceof HomeCopyError)) {
            throw error;
          }
          if (error.errorCode === 'home_copy.bad_target') {
            ctx.log.error('home_copy.bad_target');
            return 2;
          }
          return 1;
        }
      },
    },
    {
      name: 'fetch',
      usage: 'fetch --hosts blocked [--state <ST>]',
      needsFetcher: () => true,
      async run(ctx, args, fetcher) {
        if (args.flags.get('hosts') !== 'blocked' || args.flags.size !== 1) {
          console.error('usage: pnpm run pipeline fetch --hosts blocked [--state <ST>]');
          return 2;
        }
        let state: string | null = null;
        if (args.states !== null && args.states !== 'all') {
          if (args.states.length !== 1) {
            console.error('fetch --hosts blocked takes one state');
            return 2;
          }
          state = args.states[0] ?? null;
        }
        const snapshots = await loadSnapshotSources();
        const browser = lazyBrowser(requireFetcher(fetcher), ctx.log);
        try {
          const outcome = await runLocalFetch(ctx, { state, snapshots, browser: browser.open });
          return outcome.exitCode;
        } finally {
          await browser.close();
        }
      },
    },
    {
      name: 'snapshots',
      usage: 'snapshots [--state <ST,ST|all>] [--dry-run]',
      needsFetcher: () => true,
      async run(ctx, args, fetcher) {
        if (args.flags.size !== 0) {
          console.error('usage: pnpm run pipeline snapshots [--state <ST,ST|all>]');
          return 2;
        }
        const entries = await loadSnapshotSources();
        const browser = lazyBrowser(requireFetcher(fetcher), ctx.log);
        try {
          const outcomes = await runSnapshots(ctx, entries, {
            includeBlocked: false,
            states: args.states ?? 'all',
            browser: browser.open,
          });
          return snapshotsExitCode(outcomes);
        } finally {
          await browser.close();
        }
      },
    },
    {
      name: 'reachability',
      usage: 'reachability --states <ST,ST|all> [--out <path>]',
      needsFetcher: () => true,
      async run(ctx, args, fetcher) {
        const out = args.flags.get('out');
        const extra = [...args.flags.keys()].filter((flag) => flag !== 'out');
        if (args.states === null || extra.length > 0 || out === '') {
          console.error(
            'usage: pnpm run pipeline reachability --states <ST,ST|all> [--out <path>]',
          );
          return 2;
        }
        const states = args.states;
        const entries = (await loadSnapshotSources()).filter(
          (entry) =>
            (states === 'all' || states.includes(entry.state)) &&
            entry.always &&
            entry.blocked !== true,
        );
        const targets: ReachabilityTarget[] = [];
        const markers: SnapshotSource[] = [];
        for (const entry of entries) {
          if (hasMarker(entry)) {
            markers.push(entry);
            continue;
          }
          targets.push(reachabilityTarget(entry));
        }
        const report = await probeReachability(
          requireFetcher(fetcher),
          ctx.bucket,
          targets,
          ctx.now.toISOString(),
        );
        // An entry still holding a marker was not requested; the report row says so.
        const full = ReachabilityReportSchema.parse({
          ...report,
          results: [
            ...report.results,
            ...markers.map((entry) => {
              ctx.log.info('reachability.marker', { source: entry.source, state: entry.state });
              return {
                state: entry.state,
                source: entry.source,
                kind: entry.recipe.kind,
                target: markerTarget(entry),
                host: '',
                robots_status: null,
                robots: 'unavailable' as const,
                result: 'error' as const,
                status: null,
                challenge: false,
                etag_present: false,
                last_modified_present: false,
                discovered: null,
              };
            }),
          ],
        });
        await ctx.bucket.putJson(
          bucketKeys.reachability(ctx.today),
          full,
          ReachabilityReportSchema,
        );
        const json = `${JSON.stringify(full, null, 2)}\n`;
        process.stdout.write(json);
        if (out !== undefined) {
          writeFileSync(out, json);
        }
        return 0;
      },
    },
  ];
}

const TEMPLATES_CHECK_USAGE = 'templates --check';
/** The paths a failed `templates.check` line names. */
const CHECK_PATHS = 5;

/** The repository's command line: the registered stages, the bundle writer and the real fetcher. */
export function defaultCliDeps(): CliDeps {
  return {
    stages: {
      base: s01Base,
      known: s02Known,
      coops: s02Coops,
      templates: s03Templates,
      expand: s04Expand,
      deadlines: s05Deadlines,
      people: s09People,
    },
    templates: {
      templatesDir: defaultTemplatesDir(),
      rulesFor,
      loadReference: () => loadReferenceIds(repoRoot()),
    },
    runBundle,
    bundleDeps: defaultBundleDeps,
    buildSample,
    loadEnv: () => loadEnv(),
    makeLogger: (level) => createLogger({ service: 'pipeline', level }),
    async makeFetcher(env, bucket, log) {
      // Every outside request goes through the fetcher, which refuses to start without the policy.
      // The registers it enforces are loaded once per command run.
      const sources = await loadSources();
      const register = await loadTimezoneRegister();
      return createFetcher({
        transport: nodeTransport,
        clock: systemClock,
        bucket,
        log,
        isCi: env.isCi,
        userAgent: userAgent(pipelineVersion()),
        repoRoot: repoRoot(),
        hostRules: sourceHostRules(sources),
        zoneForState: (st) => zoneForState(register, st),
        // no source is marked results_host yet
        electionDatesForState: () => [],
        stateDir: fetchStateDir(),
      });
    },
  };
}

/** The names of the registered commands, in `--help` order. */
export function commandNames(deps: CliDeps = defaultCliDeps()): readonly string[] {
  return buildCommands(deps).map((command) => command.name);
}

function usage(commands: readonly Command[]): string {
  return [
    'usage: pnpm run pipeline <command> [--state <ST,ST|all>] [--dry-run] [--plan-out <path>]',
    'commands:',
    ...commands.map((command) =>
      command.name === 'templates'
        ? `  ${command.usage}\n  ${TEMPLATES_CHECK_USAGE}`
        : `  ${command.usage}`,
    ),
  ].join('\n');
}

function printDryRunCounts(bucket: DataBucket): void {
  for (const [prefix, count] of [...bucket.dryRunCounts()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    console.log(
      `dry run ${prefix}/: ${String(count.objects)} objects, ${String(count.bytes)} bytes`,
    );
  }
}

/** Removes every `--<name>` word, which takes no value; null when it is given more than once. */
function takeSwitch(argv: readonly string[], name: string): { argv: string[]; on: boolean } | null {
  const word = `--${name}`;
  const rest = argv.filter((arg) => arg !== word);
  const count = argv.length - rest.length;
  return count > 1 ? null : { argv: rest, on: count === 1 };
}

/**
 * `templates --check`: every file of the template folder validated with its registered module,
 * one `templates.check` line each; no environment, no bucket and no fetch. Exit 1 when any failed.
 */
async function templatesCheck(deps: CliDeps): Promise<number> {
  const log = deps.makeLogger('info');
  const lines = await checkTemplates(deps.templates);
  for (const line of lines) {
    const fields = {
      state: line.state,
      ok: line.ok,
      errorCount: line.errors.length,
      paths: line.errors.slice(0, CHECK_PATHS).map((error) => error.path),
    };
    if (line.ok) {
      log.info('templates.check', fields);
    } else {
      log.warn('templates.check', fields);
    }
  }
  return lines.every((line) => line.ok) ? 0 : 1;
}

/** Runs one command and returns its exit code: 0 done, 1 failed, 2 usage or environment. */
export async function main(
  argv: readonly string[],
  deps: CliDeps = defaultCliDeps(),
): Promise<number> {
  const commands = buildCommands(deps);
  const help = takeSwitch(argv, 'help');
  const check = help === null ? null : takeSwitch(help.argv, 'check');
  if (help === null || check === null) {
    console.error(usage(commands));
    return 2;
  }
  if (help.on) {
    console.log(usage(commands));
    return 0;
  }
  let args: ParsedArgs;
  try {
    args = parseArgs(check.argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error(usage(commands));
      return 2;
    }
    throw error;
  }
  const name = args.command.join(' ');
  if (check.on) {
    if (name !== 'templates' || args.states !== null || args.dryRun || args.flags.size > 0) {
      console.error(`usage: pnpm run pipeline ${TEMPLATES_CHECK_USAGE}`);
      return 2;
    }
    return templatesCheck(deps);
  }
  const command = commands.find((entry) => entry.name === name);
  if (command === undefined) {
    console.error(usage(commands));
    return 2;
  }

  let env;
  try {
    env = deps.loadEnv(deps.makeLogger('info'));
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const log = deps.makeLogger(env.LOG_LEVEL);
  const bucket = createDataBucket(dataBucketConfig(env), { dryRun: args.dryRun, log });
  const fetcher = command.needsFetcher(args) ? await deps.makeFetcher(env, bucket, log) : null;
  const started = new Date();
  const ctx = createRunContext({ env, now: started, bucket, fetcher: fetcher ?? NO_FETCHER, log });
  log.info('cli.start', { command: name, runId: ctx.runId, dryRun: args.dryRun });
  const exitCode = await command.run(ctx, args, fetcher);
  log.info('cli.done', {
    command: name,
    runId: ctx.runId,
    durationMs: Date.now() - started.getTime(),
    exitCode,
  });
  if (args.dryRun) {
    printDryRunCounts(bucket);
  }
  return exitCode;
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    // The error's class and message only: never a stack, which can carry values.
    const name = error instanceof Error ? error.name : 'Error';
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.error(`${name}: ${reason}`);
    process.exitCode = 1;
  }
}
