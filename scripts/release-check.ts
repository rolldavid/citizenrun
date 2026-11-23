// What a promotion from one ref to another carries (OPS-release-check):
//   pnpm exec tsx scripts/release-check.ts --from <ref> --to <ref>
// Reads git only. Prints a table, then one line holding the JSON report. Exits 0; 2 when a merged
// migration was edited, renamed or deleted, or on a usage error; 1 on a git error or a missing
// JOB_NAMES literal.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { run } from './lib/exec.ts';
import { repoRoot } from './lib/repo-root.ts';
import { formatTable } from './lib/table.ts';

export type ReleaseReport = {
  newMigrations: string[];
  editedMigrations: string[];
  newQueues: string[];
  infraChanged: string[];
  envSchemaChanged: string[];
  bundleSchemaChanged: string[];
};

/** `packages/shared/src/jobs.ts` at a ref holds no `JOB_NAMES` literal with a quoted name. */
export class JobNamesNotFoundError extends Error {
  constructor() {
    super('JOB_NAMES literal not found');
    this.name = 'JobNamesNotFoundError';
  }
}

const USAGE = 'usage: tsx scripts/release-check.ts --from <ref> --to <ref>';
const MIGRATIONS = 'packages/db/migrations/';
const JOURNAL = `${MIGRATIONS}meta/_journal.json`;
const JOBS_FILE = 'packages/shared/src/jobs.ts';
const JOB_NAMES_START = 'export const JOB_NAMES = [';
const JOB_NAMES_END = '] as const;';
const INFRA_FILES = new Set(['brand.json', 'packages/shared/src/brand.ts']);
const ENV_FILES = new Set([
  'apps/api/src/env.ts',
  'apps/worker/src/env.ts',
  'apps/worker/src/backup/env.ts',
]);
const FIELDS = [
  'newMigrations',
  'editedMigrations',
  'newQueues',
  'infraChanged',
  'envSchemaChanged',
  'bundleSchemaChanged',
] as const satisfies readonly (keyof ReleaseReport)[];

/** The queue names of a `jobs.ts` source, in order of appearance, `//` comments ignored. */
export function parseJobNames(source: string): string[] {
  const start = source.indexOf(JOB_NAMES_START);
  if (start === -1) {
    throw new JobNamesNotFoundError();
  }
  const bodyStart = start + JOB_NAMES_START.length;
  const end = source.indexOf(JOB_NAMES_END, bodyStart);
  if (end === -1) {
    throw new JobNamesNotFoundError();
  }
  const body = source
    .slice(bodyStart, end)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const names = [...body.matchAll(/'([^'\n]*)'/g)].map((match) => match[1] ?? '');
  if (names.length === 0) {
    throw new JobNamesNotFoundError();
  }
  return names;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Sorts each change of a `git diff --name-status --find-renames` listing into the report's lists. */
export function classifyChanges(
  nameStatus: string,
  layout: 'folders' | 'files',
): Omit<ReleaseReport, 'newQueues'> {
  const newMigrations: string[] = [];
  const editedMigrations: string[] = [];
  const infraChanged: string[] = [];
  const envSchemaChanged: string[] = [];
  const bundleSchemaChanged: string[] = [];

  const addedMigration = (path: string): void => {
    const rest = path.slice(MIGRATIONS.length);
    if (layout === 'folders') {
      newMigrations.push(rest.split('/')[0] ?? rest);
      return;
    }
    if (!rest.includes('/') && rest.endsWith('.sql')) {
      newMigrations.push(rest);
    } else if (!/^meta\/[^/]+_snapshot\.json$/.test(rest)) {
      editedMigrations.push(path);
    }
  };

  const otherLists = (path: string): void => {
    if (path.startsWith('.railway/') || INFRA_FILES.has(path)) {
      infraChanged.push(path);
    }
    if (ENV_FILES.has(path)) {
      envSchemaChanged.push(path);
    }
    if (path.startsWith('packages/shared/src/bundle/')) {
      bundleSchemaChanged.push(path);
    }
  };

  for (const line of nameStatus.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const [status = '', first = '', second] = line.split('\t');
    const kind = status.charAt(0);
    const paths = second === undefined ? [first] : [first, second];
    paths.forEach(otherLists);

    const oldPath = first;
    const newPath = second ?? first;
    if (oldPath.startsWith(MIGRATIONS)) {
      if (kind === 'A') {
        addedMigration(oldPath);
      } else if (layout === 'files' && kind === 'M' && oldPath === JOURNAL) {
        // drizzle-kit appends one journal entry per new migration: not an edit.
      } else {
        editedMigrations.push(oldPath);
      }
    } else if (newPath.startsWith(MIGRATIONS)) {
      // Renamed or copied into the folder from elsewhere: a new file there.
      addedMigration(newPath);
    }
  }

  return {
    newMigrations: sortedUnique(newMigrations),
    editedMigrations: sortedUnique(editedMigrations),
    infraChanged: sortedUnique(infraChanged),
    envSchemaChanged: sortedUnique(envSchemaChanged),
    bundleSchemaChanged: sortedUnique(bundleSchemaChanged),
  };
}

class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

type Args = { from: string; to: string };

function parseArgs(argv: readonly string[]): Args | null {
  let from: string | undefined;
  let to: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if ((arg === '--from' || arg === '--to') && value !== undefined && !value.startsWith('-')) {
      if (arg === '--from') {
        from = value;
      } else {
        to = value;
      }
      index += 1;
      continue;
    }
    return null;
  }
  if (from === undefined || to === undefined || from === '' || to === '') {
    return null;
  }
  return { from, to };
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await run('git', ['-c', 'core.quotePath=false', ...args], { cwd });
  if (result.code !== 0) {
    const reason = result.stderr.trim().split('\n')[0] ?? '';
    throw new GitError(`git ${args[0] ?? ''} failed: ${reason}`);
  }
  return result.stdout;
}

async function jobNamesAt(cwd: string, ref: string): Promise<string[]> {
  return parseJobNames(await git(cwd, ['show', `${ref}:${JOBS_FILE}`]));
}

async function buildReport(cwd: string, { from, to }: Args): Promise<ReleaseReport> {
  const nameStatus = await git(cwd, [
    'diff',
    '--name-status',
    '--find-renames',
    '--no-color',
    '--end-of-options',
    from,
    to,
  ]);
  const journal = await run('git', ['cat-file', '-e', `${to}:${JOURNAL}`], { cwd });
  const layout = journal.code === 0 ? 'files' : 'folders';
  const changes = classifyChanges(nameStatus, layout);
  const before = new Set(await jobNamesAt(cwd, from));
  const after = await jobNamesAt(cwd, to);
  const newQueues = sortedUnique(after.filter((name) => !before.has(name)));
  return {
    newMigrations: changes.newMigrations,
    editedMigrations: changes.editedMigrations,
    newQueues,
    infraChanged: changes.infraChanged,
    envSchemaChanged: changes.envSchemaChanged,
    bundleSchemaChanged: changes.bundleSchemaChanged,
  };
}

/** Runs the check; resolves with the exit code: 0 reported, 1 git error, 2 edited migration or usage. */
export async function runReleaseCheck(
  argv: readonly string[],
  io: { cwd: string; out: (line: string) => void },
): Promise<number> {
  const args = parseArgs(argv);
  if (args === null) {
    io.out(USAGE);
    return 2;
  }
  let report: ReleaseReport;
  try {
    report = await buildReport(io.cwd, args);
  } catch (error) {
    if (error instanceof GitError || error instanceof JobNamesNotFoundError) {
      io.out(`release-check: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const rows = FIELDS.map((field) => [
    field,
    String(report[field].length),
    report[field].join(', '),
  ]);
  for (const line of formatTable(['field', 'count', 'values'], rows).split('\n')) {
    io.out(line);
  }
  io.out(JSON.stringify(report));
  return report.editedMigrations.length > 0 ? 2 : 0;
}

const invoked = process.argv[1];
if (invoked !== undefined && realpathSync(invoked) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runReleaseCheck(process.argv.slice(2), {
    cwd: repoRoot(),
    out: console.log,
  });
}
