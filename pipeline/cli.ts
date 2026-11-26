// The pipeline's command line: pnpm run pipeline <command> [--state <ST,ST|all>] [--dry-run].
// The only file of the package that writes to the console.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { z } from 'zod';
import { runSnapshots, snapshotsExitCode } from './crawlers/archiver.ts';
import { EnvError, loadEnv } from './env.ts';
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
import { NO_FETCHER, createRunContext } from './lib/runner.ts';
import type { RunContext } from './lib/runner.ts';
import { loadTimezoneRegister, zoneForState } from './lib/timezones.ts';

type Command = {
  name: string;
  needsFetcher: boolean;
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

const COMMANDS: readonly Command[] = [
  {
    name: 'housekeeping',
    needsFetcher: false,
    async run(ctx) {
      await housekeeping(ctx.bucket, ctx.now, ctx.log);
      return 0;
    },
  },
  {
    name: 'home-copy',
    needsFetcher: false,
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
    needsFetcher: true,
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
    needsFetcher: true,
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
    needsFetcher: true,
    async run(ctx, args, fetcher) {
      const out = args.flags.get('out');
      const extra = [...args.flags.keys()].filter((flag) => flag !== 'out');
      if (args.states === null || extra.length > 0 || out === '') {
        console.error('usage: pnpm run pipeline reachability --states <ST,ST|all> [--out <path>]');
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
      await ctx.bucket.putJson(bucketKeys.reachability(ctx.today), full, ReachabilityReportSchema);
      const json = `${JSON.stringify(full, null, 2)}\n`;
      process.stdout.write(json);
      if (out !== undefined) {
        writeFileSync(out, json);
      }
      return 0;
    },
  },
];

function usage(): string {
  return [
    'usage: pnpm run pipeline <command> [--state <ST,ST|all>] [--dry-run]',
    'commands:',
    ...COMMANDS.map((command) => `  ${command.name}`),
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

/** Runs one command and returns its exit code: 0 done, 1 failed, 2 usage or environment. */
export async function main(argv: readonly string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      console.error(usage());
      return 2;
    }
    throw error;
  }
  const name = args.command.join(' ');
  const command = COMMANDS.find((entry) => entry.name === name);
  if (command === undefined) {
    console.error(usage());
    return 2;
  }

  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const log = createLogger({ service: 'pipeline', level: env.LOG_LEVEL });
  const bucket = createDataBucket(dataBucketConfig(env), { dryRun: args.dryRun, log });
  // Every outside request goes through the fetcher, which refuses to start without the policy.
  // The registers it enforces are loaded once per command run.
  let fetcher: PipelineFetcher | null = null;
  if (command.needsFetcher) {
    const sources = await loadSources();
    const register = await loadTimezoneRegister();
    fetcher = createFetcher({
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
  }
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
