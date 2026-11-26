import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { run } from './lib/exec.ts';
import type { RunResult } from './lib/exec.ts';
import { repoRoot } from './lib/repo-root.ts';

/** The licence allow-list (D-118, D-803, D-867). Adding to it needs a decision. */
export const ALLOWED: ReadonlySet<string> = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'MPL-2.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  'CC-BY-4.0',
  'Zlib',
]);

const EXCEPTIONS_FILE = 'scripts/licenses/exceptions.json';
const DECISION = /^D-\d{3}$/;

export type LicenseEntry = { workspace: string; name: string; version: string; license: string };

const ExceptionSchema = z.object({
  package: z.string().min(1),
  versions: z.array(z.string().min(1)),
  workspaces: z.array(z.string().min(1)),
  decision: z.string(),
  reason: z.string(),
});
export type LicenseException = z.infer<typeof ExceptionSchema>;
export const ExceptionsSchema = z.array(ExceptionSchema);

type Token = { kind: 'open' | 'close' | 'and' | 'or' | 'with' | 'id'; text: string };

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\()|(\))|([A-Za-z0-9.+:-]+))/y;
  let index = 0;
  while (index < expression.length) {
    if (/^\s*$/.test(expression.slice(index))) {
      break;
    }
    pattern.lastIndex = index;
    const match = pattern.exec(expression);
    if (match === null) {
      return null;
    }
    index = pattern.lastIndex;
    const [, open, close, word] = match;
    if (open !== undefined) {
      tokens.push({ kind: 'open', text: open });
    } else if (close !== undefined) {
      tokens.push({ kind: 'close', text: close });
    } else if (word !== undefined) {
      const upper = word.toUpperCase();
      const kind =
        upper === 'AND' ? 'and' : upper === 'OR' ? 'or' : upper === 'WITH' ? 'with' : 'id';
      tokens.push({ kind, text: word });
    }
  }
  return tokens;
}

/**
 * True when an SPDX expression is satisfied by the allowed identifiers: `OR` passes when one side
 * does, `AND` when both do, and `X WITH Y` only when that whole term is allowed. An empty, missing
 * or unparseable expression fails.
 */
export function satisfies(expression: string, allowed: ReadonlySet<string>): boolean {
  const tokens = tokenize(expression);
  if (tokens === null || tokens.length === 0) {
    return false;
  }
  let position = 0;
  const peek = (): Token | undefined => tokens[position];

  const parsePrimary = (): boolean | null => {
    const token = peek();
    if (token?.kind === 'open') {
      position += 1;
      const inner = parseOr();
      if (inner === null || peek()?.kind !== 'close') {
        return null;
      }
      position += 1;
      return inner;
    }
    if (token?.kind !== 'id') {
      return null;
    }
    position += 1;
    if (peek()?.kind === 'with') {
      position += 1;
      const exception = peek();
      if (exception?.kind !== 'id') {
        return null;
      }
      position += 1;
      return allowed.has(`${token.text} WITH ${exception.text}`);
    }
    return allowed.has(token.text);
  };

  const parseAnd = (): boolean | null => {
    let result = parsePrimary();
    while (result !== null && peek()?.kind === 'and') {
      position += 1;
      const right = parsePrimary();
      result = right === null ? null : result && right;
    }
    return result;
  };

  const parseOr = (): boolean | null => {
    let result = parseAnd();
    while (result !== null && peek()?.kind === 'or') {
      position += 1;
      const right = parseAnd();
      result = right === null ? null : result || right;
    }
    return result;
  };

  const result = parseOr();
  return result === true && position === tokens.length;
}

/** One line for each exception that cites no decision; such an entry exempts nothing. */
export function invalidExceptions(exceptions: readonly LicenseException[]): string[] {
  return exceptions
    .filter((exception) => !DECISION.test(exception.decision))
    .map(
      (exception) =>
        `exception for ${exception.package} cites "${exception.decision}", not a decision id (D-NNN)`,
    );
}

function packageMatches(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

/** True when a valid exception names this package, at this version, for this workspace. */
export function isExcepted(entry: LicenseEntry, exceptions: readonly LicenseException[]): boolean {
  return exceptions.some(
    (exception) =>
      DECISION.test(exception.decision) &&
      packageMatches(exception.package, entry.name) &&
      exception.versions.includes(entry.version) &&
      exception.workspaces.includes(entry.workspace),
  );
}

/** The entries whose licence the allow-list does not satisfy and no exception covers. */
export function findFailures(
  entries: readonly LicenseEntry[],
  exceptions: readonly LicenseException[],
): LicenseEntry[] {
  return entries.filter(
    (entry) => !satisfies(entry.license, ALLOWED) && !isExcepted(entry, exceptions),
  );
}

const ListedPackageSchema = z.object({
  name: z.string(),
  versions: z.array(z.string()),
  license: z.string().optional(),
});
const LicensesListSchema = z.record(z.string(), z.array(ListedPackageSchema));
const WorkspacesSchema = z.array(z.object({ name: z.string() }));

/**
 * The whole output of pnpm 12 (12.21.0, read from the installed pnpm) for a workspace with no
 * dependency when it prints text instead of JSON. With `--json` that version prints `{}`, which
 * reads as no rows like any other JSON list. No other text means "no rows".
 */
export const NO_DEPENDENCY_MESSAGE = 'No licenses in packages found';

/** The output of `pnpm licenses list` was neither JSON of the expected shape nor the message. */
export class UnreadableLicensesListError extends Error {
  override readonly name = 'UnreadableLicensesListError';

  constructor() {
    super('the licence list is not JSON of the expected shape');
  }
}

function parseListed(text: string): z.infer<typeof LicensesListSchema> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UnreadableLicensesListError();
  }
  const listed = LicensesListSchema.safeParse(value);
  if (!listed.success) {
    throw new UnreadableLicensesListError();
  }
  return listed.data;
}

/**
 * The rows of `pnpm licenses list --json` for one workspace. No rows only for JSON that lists none
 * or for NO_DEPENDENCY_MESSAGE; any other output (empty, a notice before the JSON, text) throws
 * UnreadableLicensesListError, because a list that cannot be read must fail the check.
 */
export function parseLicensesList(workspace: string, stdout: string): LicenseEntry[] {
  const text = stdout.trim();
  if (text === NO_DEPENDENCY_MESSAGE) {
    return [];
  }
  const listed = parseListed(text);
  const entries: LicenseEntry[] = [];
  for (const [group, packages] of Object.entries(listed)) {
    for (const item of packages) {
      for (const version of item.versions) {
        entries.push({ workspace, name: item.name, version, license: item.license ?? group });
      }
    }
  }
  return entries;
}

/** The first dependency path of `pnpm why`: the package up to the first workspace that needs it. */
export function firstPath(whyOutput: string): string {
  const names: string[] = [];
  for (const line of whyOutput.split('\n')) {
    const name = line.replace(/^[\s│├└─┬]+/u, '').trim();
    if (name === '') {
      continue;
    }
    names.push(name.replace(/\s*\((?:dev|optional|peer)?[dD]ependencies\)$/, ''));
    if (/\((?:dev|optional|peer)?[dD]ependencies\)$/.test(name)) {
      break;
    }
  }
  return names.join(' < ');
}

/** Runs pnpm with an argument array in `cwd`; the check's one way out to the package manager. */
export type PnpmRunner = (args: readonly string[], cwd: string) => Promise<RunResult>;

const runPnpm: PnpmRunner = (args, cwd) => run('pnpm', args, { cwd });

async function pnpm(runner: PnpmRunner, args: readonly string[], cwd: string): Promise<string> {
  const result = await runner(args, cwd);
  if (result.code !== 0) {
    throw new Error(
      `pnpm ${args.join(' ')} exited with ${String(result.code)}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/**
 * Checks every workspace's dependency licences; prints one line per failure and one per workspace
 * whose list cannot be read, and returns 1 when there is any.
 */
export async function main(runner: PnpmRunner = runPnpm): Promise<number> {
  const root = repoRoot();
  const exceptions = ExceptionsSchema.parse(
    JSON.parse(readFileSync(join(root, EXCEPTIONS_FILE), 'utf8')),
  );
  const problems = invalidExceptions(exceptions);
  const workspaces = WorkspacesSchema.parse(
    JSON.parse(await pnpm(runner, ['ls', '-r', '--depth', '-1', '--json'], root)),
  ).map((workspace) => workspace.name);
  for (const workspace of workspaces) {
    const stdout = await pnpm(runner, ['licenses', 'list', '--json', '--filter', workspace], root);
    let listed: LicenseEntry[];
    try {
      listed = parseLicensesList(workspace, stdout);
    } catch (error) {
      if (error instanceof UnreadableLicensesListError) {
        problems.push(`${workspace}: ${error.message}; its licences could not be checked`);
        continue;
      }
      throw error;
    }
    for (const failure of findFailures(listed, exceptions)) {
      const why = await runner(['why', failure.name, '--filter', workspace], root);
      problems.push(
        `${failure.name}@${failure.version} (${failure.license}) in ${workspace}: ${firstPath(why.stdout)}`,
      );
    }
  }
  for (const problem of problems) {
    console.log(problem);
  }
  return problems.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
