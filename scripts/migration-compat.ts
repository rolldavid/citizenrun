// The previous code's tests against the current migrations (TEST-migration-compat):
//   pnpm exec tsx scripts/migration-compat.ts --base <ref>
// Checks out <ref> in a temporary git worktree, installs it, and runs its API and worker
// integration tests with TEST_MIGRATIONS_DIR set to this checkout's migrations. The tests of
// packages/db are left out: they check the schema the old code was written against. Every
// command runs without a shell, from an argument array.
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/exec.ts';
import type { RunResult } from './lib/exec.ts';
import { repoRoot } from './lib/repo-root.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** One command: an argument array, the folder it runs in and the variables it adds. */
export type Cmd = { argv: readonly string[]; cwd: string; env?: Readonly<Record<string, string>> };

export type CompatPlan = { setup: Cmd[]; run: Cmd; cleanup: Cmd[] };

const USAGE = 'usage: pnpm exec tsx scripts/migration-compat.ts --base <ref>';

/** A command-line mistake; the script prints the one-line usage and exits 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
  readonly exitCode = 2;
}

/** Reads `--base <ref>`; throws UsageError when it is missing or empty or an argument is unknown. */
export function parseArgs(argv: readonly string[]): { base: string } {
  let base: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') {
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new UsageError(USAGE);
      }
      base = value;
      index += 1;
    } else {
      throw new UsageError(USAGE);
    }
  }
  if (base === null) {
    throw new UsageError(USAGE);
  }
  return { base };
}

/** The commands of one run, in order: the worktree, its install, the compose stack, the tests. */
export function buildPlan(args: {
  base: string;
  sha: string;
  worktree: string;
  repoRoot: string;
  ci: boolean;
}): CompatPlan {
  const setup: Cmd[] = [
    { argv: ['git', 'worktree', 'add', '--detach', args.worktree, args.sha], cwd: args.repoRoot },
    { argv: ['pnpm', 'install', '--frozen-lockfile'], cwd: args.worktree },
  ];
  if (!args.ci) {
    // In CI the job's service containers are the stack.
    setup.push({ argv: ['docker', 'compose', 'up', '-d', '--wait'], cwd: args.repoRoot });
  }
  return {
    setup,
    run: {
      argv: [
        'pnpm',
        '--filter',
        '@citizenrun/api',
        '--filter',
        '@citizenrun/worker',
        'run',
        'test:integration',
      ],
      cwd: args.worktree,
      // Absolute, so the worktree never resolves it against itself.
      env: { TEST_MIGRATIONS_DIR: join(args.repoRoot, 'packages/db/migrations'), TZ: 'UTC' },
    },
    cleanup: [
      { argv: ['git', 'worktree', 'remove', '--force', args.worktree], cwd: args.repoRoot },
      { argv: ['git', 'worktree', 'prune'], cwd: args.repoRoot },
    ],
  };
}

/** The major version `pg_dump --version` reports, or null. */
export function pgDumpMajor(output: string): number | null {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(output);
  return match === null ? null : Number(match[1]);
}

export type CompatDeps = {
  /** Runs a command; with `inherit` its output goes to this terminal. */
  exec: (cmd: Cmd, inherit: boolean) => Promise<RunResult>;
  makeTempDir: () => string;
  removeDir: (path: string) => void;
  env: Env;
  repoRoot: string;
  out: (line: string) => void;
  err: (line: string) => void;
  now: () => number;
};

function defaultDeps(): CompatDeps {
  const env: Env = process.env;
  return {
    exec: async (cmd, inherit) => {
      const [command = '', ...args] = cmd.argv;
      try {
        return await run(command, args, {
          cwd: cmd.cwd,
          env: { ...env, ...cmd.env },
          inherit,
        });
      } catch {
        // The program is missing or could not start.
        return { code: 127, stdout: '', stderr: '' };
      }
    },
    makeTempDir: () => mkdtempSync(join(tmpdir(), 'migration-compat-')),
    removeDir: (path) => {
      if (existsSync(path)) {
        rmSync(path, { recursive: true, force: true });
      }
    },
    env,
    repoRoot: repoRoot(),
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    err: (line) => {
      process.stderr.write(`${line}\n`);
    },
    now: () => performance.now(),
  };
}

/** Runs the check and resolves with the exit code: the tests' own, 1 before them, 2 for usage. */
export async function main(
  argv: readonly string[],
  deps: CompatDeps = defaultDeps(),
): Promise<number> {
  let base: string;
  try {
    ({ base } = parseArgs(argv));
  } catch (error) {
    if (error instanceof UsageError) {
      deps.err(error.message);
      return error.exitCode;
    }
    throw error;
  }
  const started = deps.now();

  // The worker's backup test needs pg_dump 17, as in ci-local.ts.
  const pgDump = await deps.exec({ argv: ['pg_dump', '--version'], cwd: deps.repoRoot }, false);
  if (pgDump.code !== 0 || pgDumpMajor(pgDump.stdout) !== 17) {
    deps.err('migration-compat: pg_dump 17 must be first on PATH (postgresql-client-17)');
    return 1;
  }
  const resolved = await deps.exec(
    { argv: ['git', 'rev-parse', '--verify', '--quiet', `${base}^{commit}`], cwd: deps.repoRoot },
    false,
  );
  const sha = resolved.stdout.trim();
  if (resolved.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    deps.err(`migration-compat: ${base} does not name a commit`);
    return 1;
  }
  deps.out(`migration-compat base ${sha.slice(0, 12)}`);

  const worktree = deps.makeTempDir();
  const ci = deps.env.CI !== undefined && deps.env.CI !== '';
  const plan = buildPlan({ base, sha, worktree, repoRoot: deps.repoRoot, ci });
  let code = 1;
  try {
    let ready = true;
    for (const cmd of plan.setup) {
      const result = await deps.exec(cmd, true);
      if (result.code !== 0) {
        deps.err(`migration-compat: ${cmd.argv.join(' ')} exited ${String(result.code)}`);
        code = result.code;
        ready = false;
        break;
      }
    }
    if (ready) {
      code = (await deps.exec(plan.run, true)).code;
    }
  } finally {
    for (const cmd of plan.cleanup) {
      await deps.exec(cmd, false);
    }
    // A worktree that could not be added or removed leaves its folder; remove it and prune again.
    deps.removeDir(worktree);
    const prune = plan.cleanup.at(-1);
    if (prune !== undefined) {
      await deps.exec(prune, false);
    }
  }
  const seconds = Math.round((deps.now() - started) / 100) / 10;
  deps.out(`migration-compat ${code === 0 ? 'pass' : 'fail'} ${String(seconds)}s`);
  return code;
}

const invoked = process.argv[1];
if (invoked !== undefined && realpathSync(invoked) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
