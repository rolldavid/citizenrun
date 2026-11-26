import { PIPELINE_STATES } from './states.ts';

export type ParsedArgs = {
  readonly command: readonly string[];
  readonly states: readonly string[] | 'all' | null;
  readonly dryRun: boolean;
  readonly flags: ReadonlyMap<string, string>;
};

/** A command line the pipeline cannot read; the command line prints the usage and exits 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

const COMMAND_WORD = /^[a-z][a-z0-9-]*$/;
const FLAG_NAME = /^[a-z][a-z0-9-]*$/;
const NATIONAL = 'US';
const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...PIPELINE_STATES.map((row) => row.code),
  NATIONAL,
]);

function parseStates(value: string): readonly string[] | 'all' {
  if (value === 'all') {
    return 'all';
  }
  const codes = value.split(',');
  const seen = new Set<string>();
  for (const code of codes) {
    if (!KNOWN_CODES.has(code)) {
      throw new UsageError(`--state takes all or a comma list of state codes; ${code} is not one`);
    }
    if (seen.has(code)) {
      throw new UsageError(`--state names ${code} twice`);
    }
    seen.add(code);
  }
  return Object.freeze(codes);
}

/**
 * Reads `pnpm pipeline <command> [flags]`. The words before the first flag form the command;
 * `--state` (or `--states`) takes `all` or a comma list of upper-case codes of the 50 states, DC
 * and `US`; `--dry-run` takes no value; every other flag is `--name value` or `--name=value`.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = [];
  const flags = new Map<string, string>();
  let states: readonly string[] | 'all' | null = null;
  let dryRun = false;
  let index = 0;
  while (index < argv.length && !(argv[index] ?? '').startsWith('--')) {
    const word = argv[index] ?? '';
    if (!COMMAND_WORD.test(word)) {
      throw new UsageError(`${word === '' ? 'an empty word' : 'a word'} is not a command`);
    }
    command.push(word);
    index += 1;
  }
  while (index < argv.length) {
    const arg = argv[index] ?? '';
    if (!arg.startsWith('--')) {
      throw new UsageError('every argument after the command is a flag');
    }
    const body = arg.slice(2);
    const equals = body.indexOf('=');
    const name = equals === -1 ? body : body.slice(0, equals);
    if (!FLAG_NAME.test(name)) {
      throw new UsageError('a flag name is lower-case letters, digits and hyphens');
    }
    if (name === 'dry-run') {
      if (equals !== -1) {
        throw new UsageError('--dry-run takes no value');
      }
      if (dryRun) {
        throw new UsageError('--dry-run is given twice');
      }
      dryRun = true;
      index += 1;
      continue;
    }
    let value: string;
    if (equals === -1) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UsageError(`--${name} needs a value`);
      }
      value = next;
      index += 2;
    } else {
      value = body.slice(equals + 1);
      index += 1;
    }
    if (value === '') {
      throw new UsageError(`--${name} needs a value`);
    }
    if (name === 'state' || name === 'states') {
      if (states !== null) {
        throw new UsageError('--state is given twice');
      }
      states = parseStates(value);
      continue;
    }
    if (flags.has(name)) {
      throw new UsageError(`--${name} is given twice`);
    }
    flags.set(name, value);
  }
  return Object.freeze({ command: Object.freeze(command), states, dryRun, flags });
}
