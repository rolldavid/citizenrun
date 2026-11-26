// The pipeline's command line: pnpm pipeline <command> [--state <ST,ST|all>] [--dry-run].
// The only file of the package that writes to the console.
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@citizenrun/shared';
import { z } from 'zod';
import { EnvError, loadEnv } from './env.ts';
import { parseArgs, UsageError } from './lib/args.ts';
import type { ParsedArgs } from './lib/args.ts';
import { createDataBucket, dataBucketConfig } from './lib/bucket.ts';
import type { DataBucket } from './lib/bucket.ts';
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
import { NO_FETCHER, createRunContext } from './lib/runner.ts';
import type { RunContext } from './lib/runner.ts';

type Command = {
  name: string;
  needsFetcher: boolean;
  /** `fetcher` is the PipelineFetcher of a command that needs one (the same object as ctx.fetcher), else null. */
  run(ctx: RunContext, args: ParsedArgs, fetcher: PipelineFetcher | null): Promise<number>;
};

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
    async run(ctx, args) {
      if (args.flags.get('hosts') !== 'blocked' || args.flags.size !== 1) {
        console.error('usage: pnpm pipeline fetch --hosts blocked [--state <ST>]');
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
      const outcome = await runLocalFetch(ctx, { state });
      return outcome.exitCode;
    },
  },
];

function usage(): string {
  return [
    'usage: pnpm pipeline <command> [--state <ST,ST|all>] [--dry-run]',
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
  const fetcher = command.needsFetcher
    ? createFetcher({
        transport: nodeTransport,
        clock: systemClock,
        bucket,
        log,
        isCi: env.isCi,
        userAgent: userAgent(pipelineVersion()),
        repoRoot: repoRoot(),
        hostRules: { forbiddenHosts: [], resultsHosts: [] },
        zoneForState: () => null,
        electionDatesForState: () => [],
        stateDir: fetchStateDir(),
      })
    : null;
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
