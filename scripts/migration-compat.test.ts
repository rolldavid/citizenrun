import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError, buildPlan, main, parseArgs, pgDumpMajor } from './migration-compat.ts';
import type { Cmd, CompatDeps } from './migration-compat.ts';

const SHA = 'a'.repeat(40);
const ROOT = join('/', 'fixture', 'checkout');
const WORKTREE = join('/', 'fixture', 'tmp', 'migration-compat-x1');

const TEST_RUN = [
  'pnpm',
  '--filter',
  '@citizenrun/api',
  '--filter',
  '@citizenrun/worker',
  'run',
  'test:integration',
];

function plan(ci: boolean): ReturnType<typeof buildPlan> {
  return buildPlan({ base: 'main', sha: SHA, worktree: WORKTREE, repoRoot: ROOT, ci });
}

type Fake = { deps: CompatDeps; calls: Cmd[]; out: string[]; err: string[]; removed: string[] };

// A runner that answers pg_dump and git rev-parse, fails the test run with `runCode`, and records
// every command.
function fakeDeps(options: { runCode?: number; env?: Record<string, string> } = {}): Fake {
  const calls: Cmd[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const removed: string[] = [];
  const deps: CompatDeps = {
    exec: (cmd) => {
      calls.push(cmd);
      const [command, ...args] = cmd.argv;
      if (command === 'pg_dump') {
        return Promise.resolve({ code: 0, stdout: 'pg_dump (PostgreSQL) 17.6\n', stderr: '' });
      }
      if (command === 'git' && args[0] === 'rev-parse') {
        return Promise.resolve({ code: 0, stdout: `${SHA}\n`, stderr: '' });
      }
      if (cmd.argv.join(' ') === TEST_RUN.join(' ')) {
        return Promise.resolve({ code: options.runCode ?? 0, stdout: '', stderr: '' });
      }
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    },
    makeTempDir: () => WORKTREE,
    removeDir: (path) => {
      removed.push(path);
    },
    env: options.env ?? {},
    repoRoot: ROOT,
    out: (line) => {
      out.push(line);
    },
    err: (line) => {
      err.push(line);
    },
    now: () => 0,
  };
  return { deps, calls, out, err, removed };
}

describe('migration-compat', () => {
  it('requires a base', async () => {
    for (const argv of [[], ['--base'], ['--base', ''], ['--other', 'main']]) {
      let caught: unknown = null;
      try {
        parseArgs(argv);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UsageError);
      expect(caught instanceof UsageError ? caught.exitCode : null).toBe(2);
    }
    expect(parseArgs(['--base', 'origin/staging'])).toEqual({ base: 'origin/staging' });

    const fake = fakeDeps();
    expect(await main([], fake.deps)).toBe(2);
    expect(fake.err).toHaveLength(1);
    expect(fake.err[0]).toContain('--base <ref>');
    expect(fake.err[0]).not.toContain('\n');
    expect(fake.calls).toEqual([]);
  });

  it('plans the worktree, the install and the run', () => {
    const { setup, run, cleanup } = plan(true);
    expect(setup).toEqual([
      { argv: ['git', 'worktree', 'add', '--detach', WORKTREE, SHA], cwd: ROOT },
      { argv: ['pnpm', 'install', '--frozen-lockfile'], cwd: WORKTREE },
    ]);
    expect(run.argv).toEqual(TEST_RUN);
    expect(run.cwd).toBe(WORKTREE);
    expect(run.env).toEqual({
      TEST_MIGRATIONS_DIR: join(ROOT, 'packages/db/migrations'),
      TZ: 'UTC',
    });
    expect(run.env?.TEST_MIGRATIONS_DIR?.startsWith(ROOT)).toBe(true);
    expect(cleanup).toEqual([
      { argv: ['git', 'worktree', 'remove', '--force', WORKTREE], cwd: ROOT },
      { argv: ['git', 'worktree', 'prune'], cwd: ROOT },
    ]);
  });

  it('starts the compose stack only outside CI', async () => {
    const compose = { argv: ['docker', 'compose', 'up', '-d', '--wait'], cwd: ROOT };
    expect(plan(false).setup).toEqual([...plan(true).setup, compose]);
    expect(plan(true).setup).not.toContainEqual(compose);

    const local = fakeDeps();
    await main(['--base', 'main'], local.deps);
    expect(local.calls).toContainEqual(compose);
    const ci = fakeDeps({ env: { CI: 'true' } });
    await main(['--base', 'main'], ci.deps);
    expect(ci.calls).not.toContainEqual(compose);
  });

  it('always removes the worktree', async () => {
    const fake = fakeDeps({ runCode: 3 });
    expect(await main(['--base', 'main'], fake.deps)).toBe(3);
    const lines = fake.calls.map((cmd) => cmd.argv.join(' '));
    const ran = lines.indexOf(TEST_RUN.join(' '));
    expect(ran).toBeGreaterThan(-1);
    expect(lines.slice(ran + 1)).toEqual([
      `git worktree remove --force ${WORKTREE}`,
      'git worktree prune',
      'git worktree prune',
    ]);
    expect(fake.removed).toEqual([WORKTREE]);
    expect(fake.out).toEqual([
      `migration-compat base ${SHA.slice(0, 12)}`,
      'migration-compat fail 0s',
    ]);

    const passing = fakeDeps();
    expect(await main(['--base', 'main'], passing.deps)).toBe(0);
    expect(passing.out.at(-1)).toBe('migration-compat pass 0s');
  });

  it('uses no shell', () => {
    for (const ci of [true, false]) {
      const { setup, run, cleanup } = plan(ci);
      for (const cmd of [...setup, run, ...cleanup]) {
        expect(Array.isArray(cmd.argv)).toBe(true);
        expect(cmd.argv.length).toBeGreaterThan(1);
        for (const arg of cmd.argv) {
          expect(typeof arg).toBe('string');
          expect(arg).not.toMatch(/&&|\||;/);
        }
      }
    }
  });

  it('needs pg_dump 17 and a base that names a commit', async () => {
    expect(pgDumpMajor('pg_dump (PostgreSQL) 17.6 (Homebrew)')).toBe(17);
    expect(pgDumpMajor('pg_dump (PostgreSQL) 16.4')).toBe(16);
    expect(pgDumpMajor('nothing')).toBeNull();

    const oldDump = fakeDeps();
    const exec = oldDump.deps.exec;
    oldDump.deps.exec = (cmd, inherit) =>
      cmd.argv[0] === 'pg_dump'
        ? Promise.resolve({ code: 0, stdout: 'pg_dump (PostgreSQL) 16.4\n', stderr: '' })
        : exec(cmd, inherit);
    expect(await main(['--base', 'main'], oldDump.deps)).toBe(1);
    expect(oldDump.calls).toEqual([]);

    const noCommit = fakeDeps();
    const execNoCommit = noCommit.deps.exec;
    noCommit.deps.exec = (cmd, inherit) =>
      cmd.argv[1] === 'rev-parse'
        ? Promise.resolve({ code: 1, stdout: '', stderr: '' })
        : execNoCommit(cmd, inherit);
    expect(await main(['--base', 'no-such-ref'], noCommit.deps)).toBe(1);
    expect(noCommit.err.join('\n')).toContain('no-such-ref');
    expect(noCommit.calls.some((cmd) => cmd.argv.includes('worktree'))).toBe(false);
  });
});
