import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './lib/exec.ts';
import {
  JobNamesNotFoundError,
  classifyChanges,
  parseJobNames,
  runReleaseCheck,
} from './release-check.ts';
import type { ReleaseReport } from './release-check.ts';

const JOBS = 'packages/shared/src/jobs.ts';
const MIG = 'packages/db/migrations';

/** A jobs.ts fixture laid out as the shared job list is: several names per line, each line commented. */
function jobsSource(lines: readonly string[]): string {
  return [
    "import { z } from 'zod';",
    '',
    'export const JOB_NAMES = [',
    ...lines.map((line) => `  ${line}`),
    '] as const;',
    'export type JobName = (typeof JOB_NAMES)[number];',
    "export const OTHER = ['not.a.queue'] as const;",
    '',
  ].join('\n');
}

const BASE_JOB_LINES = [
  "'ops.dead', 'ops.alert',                  // dead letters and admin alerts",
  "'backup.check', 'db.connections-check',   // daily health checks",
];

type Files = Record<string, string | null>;

let dir = '';
let gitEnv: Record<string, string | undefined> = {};

async function git(args: readonly string[]): Promise<void> {
  const result = await run('git', args, { cwd: dir, env: gitEnv });
  if (result.code !== 0) {
    throw new Error(`fixture git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function write(files: Files): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    if (content === null) {
      rmSync(full, { force: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

async function commit(message: string): Promise<void> {
  await git(['add', '-A']);
  await git([
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    message,
  ]);
}

/** A fixture repository with a first commit (tagged `base`) and a second one at `HEAD`. */
async function fixture(
  base: Files,
  change: Files,
  renames: [string, string][] = [],
): Promise<void> {
  await git(['init', '-q', '-b', 'main']);
  write(base);
  await commit('first');
  await git(['tag', 'base']);
  for (const [from, to] of renames) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    await git(['mv', from, to]);
  }
  write(change);
  await commit('second');
}

function baseFiles(extra: Files = {}): Files {
  return {
    [JOBS]: jobsSource(BASE_JOB_LINES),
    [`${MIG}/20261122000000_base/migration.sql`]: 'create table base_one (id int);\n',
    [`${MIG}/20261122000000_base/snapshot.json`]: '{"id":"base-one"}\n',
    [`${MIG}/20261123000000_second/migration.sql`]: 'create table second_two (id text);\n',
    [`${MIG}/20261123000000_second/snapshot.json`]: '{"id":"second-two"}\n',
    'README.md': 'fixture\n',
    ...extra,
  };
}

async function check(argv: readonly string[]): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await runReleaseCheck(argv, { cwd: dir, out: (line) => lines.push(line) });
  return { code, lines };
}

function report(lines: readonly string[]): ReleaseReport {
  return JSON.parse(lines.at(-1) ?? '') as ReleaseReport;
}

const FROM_TO = ['--from', 'base', '--to', 'HEAD'] as const;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-check-'));
  // HOME points at the fixture folder, so no git configuration of the machine is read or changed.
  gitEnv = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' };
  vi.stubEnv('HOME', dir);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runReleaseCheck', { timeout: 20000 }, () => {
  it('a new migration folder is reported', async () => {
    await fixture(baseFiles(), {
      [`${MIG}/20270101000000_add_x/migration.sql`]: 'create table x (id int);\n',
      [`${MIG}/20270101000000_add_x/snapshot.json`]: '{"id":"x"}\n',
    });
    const { code, lines } = await check(FROM_TO);
    expect(report(lines).newMigrations).toEqual(['20270101000000_add_x']);
    expect(report(lines).editedMigrations).toEqual([]);
    expect(code).toBe(0);
  });

  it('an edited migration stops the release', async () => {
    await fixture(baseFiles(), {
      [`${MIG}/20261122000000_base/migration.sql`]: 'create table base_one (id bigint);\n',
    });
    const { code, lines } = await check(FROM_TO);
    expect(report(lines).editedMigrations).toEqual([`${MIG}/20261122000000_base/migration.sql`]);
    expect(report(lines).newMigrations).toEqual([]);
    expect(code).toBe(2);
  });

  it('a renamed or deleted migration is an edit', async () => {
    await fixture(
      baseFiles(),
      {
        [`${MIG}/20261123000000_second/migration.sql`]: null,
        [`${MIG}/20261123000000_second/snapshot.json`]: null,
      },
      [[`${MIG}/20261122000000_base`, `${MIG}/20261122000001_base`]],
    );
    const { code, lines } = await check(FROM_TO);
    const edited = report(lines).editedMigrations;
    expect(edited).toContain(`${MIG}/20261122000000_base/migration.sql`);
    expect(edited).toContain(`${MIG}/20261123000000_second/migration.sql`);
    expect(edited.some((path) => path.includes('20261122000001_base'))).toBe(false);
    expect(report(lines).newMigrations).toEqual([]);
    expect(code).toBe(2);
  });

  it('in the file layout the journal append is not an edit', async () => {
    await fixture(
      {
        [JOBS]: jobsSource(BASE_JOB_LINES),
        [`${MIG}/0001_a.sql`]: 'create table a (id int);\n',
        [`${MIG}/0002_b.sql`]: 'create table b (id int);\n',
        [`${MIG}/meta/_journal.json`]: '{"entries":[{"idx":1},{"idx":2}]}\n',
        [`${MIG}/meta/0001_snapshot.json`]: '{"id":"a"}\n',
        [`${MIG}/meta/0002_snapshot.json`]: '{"id":"b"}\n',
      },
      {
        [`${MIG}/0003_x.sql`]: 'create table x (id int);\n',
        [`${MIG}/meta/0003_snapshot.json`]: '{"id":"x"}\n',
        [`${MIG}/meta/_journal.json`]: '{"entries":[{"idx":1},{"idx":2},{"idx":3}]}\n',
      },
    );
    const { code, lines } = await check(FROM_TO);
    expect(report(lines).newMigrations).toEqual(['0003_x.sql']);
    expect(report(lines).editedMigrations).toEqual([]);
    expect(code).toBe(0);
  });

  it('a new queue is reported whatever the layout', async () => {
    await fixture(baseFiles(), {
      [JOBS]: jobsSource([
        "'ops.dead', 'ops.alert',                  // dead letters and admin alerts",
        "'backup.check', 'cost.check', 'db.connections-check',   // daily health checks",
      ]),
    });
    const { code, lines } = await check(FROM_TO);
    expect(report(lines).newQueues).toEqual(['cost.check']);
    expect(code).toBe(0);
  });

  it('a quoted name inside a comment is not a queue', async () => {
    await fixture(baseFiles(), {
      [JOBS]: jobsSource([...BASE_JOB_LINES, "'ops.heartbeat', // was 'ops.retired'"]),
    });
    const { lines } = await check(FROM_TO);
    expect(report(lines).newQueues).toEqual(['ops.heartbeat']);
    expect(report(lines).newQueues).not.toContain('ops.retired');
  });

  it('infrastructure, environment and bundle changes are reported', async () => {
    await fixture(
      baseFiles({
        '.railway/railway.ts': 'export default 1;\n',
        'brand.json': '{"slug":"fixture"}\n',
        'apps/worker/src/backup/env.ts': 'export const a = 1;\n',
        'packages/shared/src/bundle/x.ts': 'export const b = 1;\n',
      }),
      {
        '.railway/railway.ts': 'export default 2;\n',
        'brand.json': '{"slug":"fixture-two"}\n',
        'apps/worker/src/backup/env.ts': 'export const a = 2;\n',
        'packages/shared/src/bundle/x.ts': 'export const b = 2;\n',
      },
    );
    const { code, lines } = await check(FROM_TO);
    const result = report(lines);
    expect(result.infraChanged).toEqual(['.railway/railway.ts', 'brand.json']);
    expect(result.envSchemaChanged).toEqual(['apps/worker/src/backup/env.ts']);
    expect(result.bundleSchemaChanged).toEqual(['packages/shared/src/bundle/x.ts']);
    expect(code).toBe(0);
  });

  it('no change reports nothing', async () => {
    await fixture(baseFiles(), { 'README.md': 'fixture, changed\n' });
    const { code, lines } = await check(FROM_TO);
    const result = report(lines);
    expect(Object.keys(result).sort()).toEqual(
      [
        'bundleSchemaChanged',
        'editedMigrations',
        'envSchemaChanged',
        'infraChanged',
        'newMigrations',
        'newQueues',
      ].sort(),
    );
    for (const value of Object.values(result)) {
      expect(value).toEqual([]);
    }
    expect(lines[0]).toMatch(/^field\s+count\s+values$/);
    expect(code).toBe(0);
  });

  it('a missing JOB_NAMES literal is a git error', async () => {
    await fixture(baseFiles(), { [JOBS]: 'export const NOTHING = [] as const;\n' });
    const { code, lines } = await check(FROM_TO);
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('JOB_NAMES');
  });

  it('an unknown ref is a git error', async () => {
    await fixture(baseFiles(), { 'README.md': 'changed\n' });
    const { code } = await check(['--from', 'base', '--to', 'no-such-ref']);
    expect(code).toBe(1);
  });

  it('missing arguments are a usage error', async () => {
    const { code, lines } = await check(['--to', 'HEAD']);
    expect(code).toBe(2);
    expect(lines).toEqual(['usage: tsx scripts/release-check.ts --from <ref> --to <ref>']);
  });

  it('a ref that looks like an option is a usage error', async () => {
    const { code, lines } = await check(['--from', '--output=x', '--to', 'HEAD']);
    expect(code).toBe(2);
    expect(lines[0]).toMatch(/^usage:/);
  });
});

describe('parseJobNames', () => {
  it('gives the names in order of appearance', () => {
    const source = jobsSource([
      "'ops.dead', 'ops.alert', 'ops.heartbeat', 'backup.check',   // operations",
      "'account.delete', 'account.export',                          // accounts",
      "'media.process.image', 'notify.email',                       // media and email",
      "// a comment line naming 'not.a.queue'",
    ]);
    expect(parseJobNames(source)).toEqual([
      'ops.dead',
      'ops.alert',
      'ops.heartbeat',
      'backup.check',
      'account.delete',
      'account.export',
      'media.process.image',
      'notify.email',
    ]);
  });

  it('throws when the literal is absent or holds no name', () => {
    expect(() => parseJobNames('export const X = 1;\n')).toThrow(JobNamesNotFoundError);
    expect(() => parseJobNames('export const JOB_NAMES = [\n  // none\n] as const;\n')).toThrow(
      JobNamesNotFoundError,
    );
  });
});

describe('classifyChanges', () => {
  it('treats a type change and a copy from a migration as edits', () => {
    const result = classifyChanges(
      [`T\t${MIG}/a/migration.sql`, `C80\t${MIG}/b/migration.sql\t${MIG}/c/migration.sql`].join(
        '\n',
      ),
      'folders',
    );
    expect(result.editedMigrations).toEqual([`${MIG}/a/migration.sql`, `${MIG}/b/migration.sql`]);
    expect(result.newMigrations).toEqual([]);
  });

  it('counts a file renamed into the folder as a new migration', () => {
    const result = classifyChanges(`R100\ttmp/draft.sql\t${MIG}/d/migration.sql`, 'folders');
    expect(result.newMigrations).toEqual(['d']);
    expect(result.editedMigrations).toEqual([]);
  });

  it('lists each folder once and every list sorted', () => {
    const result = classifyChanges(
      [
        `A\t${MIG}/z/migration.sql`,
        `A\t${MIG}/z/snapshot.json`,
        `A\t${MIG}/a/migration.sql`,
        'M\tpackages/shared/src/brand.ts',
        'M\t.railway/railway.ts',
        'M\tapps/api/src/env.ts',
        'M\tapps/worker/src/env.ts',
      ].join('\n'),
      'folders',
    );
    expect(result.newMigrations).toEqual(['a', 'z']);
    expect(result.infraChanged).toEqual(['.railway/railway.ts', 'packages/shared/src/brand.ts']);
    expect(result.envSchemaChanged).toEqual(['apps/api/src/env.ts', 'apps/worker/src/env.ts']);
  });

  it('in the file layout a journal rewrite other than a modification is an edit', () => {
    const result = classifyChanges(`D\t${MIG}/meta/_journal.json`, 'files');
    expect(result.editedMigrations).toEqual([`${MIG}/meta/_journal.json`]);
  });
});
