import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One scripted answer: the first rule whose arguments all match a call answers it. */
export type FakeRule = {
  readonly args: readonly (string | RegExp)[];
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly captureStdin?: boolean;
};

/** One recorded call. `stdin` is present only when the matching rule asked to capture it. */
export type FakeCall = {
  readonly tool: 'railway' | 'gh';
  readonly args: readonly string[];
  readonly exitCode: number;
  readonly matched: boolean;
  readonly stdinBytes: number;
  readonly stdin?: string;
};

export type FakeCli = {
  readonly binDir: string;
  env(base: Readonly<Record<string, string | undefined>>): Record<string, string>;
  calls(): FakeCall[];
  cleanup(): Promise<void>;
};

type StoredPattern = string | { re: string; flags: string };

// The shim records arguments and standard-input byte counts, never an environment value
// (TEST-fake-cli). It reads standard input to its end whenever standard input is not a terminal.
const SHIM = `import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = dirname(fileURLToPath(import.meta.url));
const tool = process.argv[2];
const args = process.argv.slice(3);
const rules = JSON.parse(readFileSync(join(folder, 'rules.json'), 'utf8'))[tool] ?? [];

function matches(pattern, value) {
  if (typeof pattern === 'string') {
    return pattern === value;
  }
  return new RegExp(pattern.re, pattern.flags).test(value);
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return Buffer.alloc(0);
  }
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const rule = rules.find(
  (candidate) =>
    candidate.args.length === args.length &&
    candidate.args.every((pattern, index) => matches(pattern, args[index])),
);
const stdin = await readStdin();
const exitCode = rule === undefined ? 97 : (rule.exitCode ?? 0);
const call = { tool, args, exitCode, matched: rule !== undefined, stdinBytes: stdin.length };
if (rule !== undefined && rule.captureStdin === true) {
  call.stdin = stdin.toString('utf8');
}
appendFileSync(join(folder, 'calls.jsonl'), JSON.stringify(call) + '\\n');
if (rule === undefined) {
  process.stderr.write('fake-cli: unscripted ' + tool + ' ' + args.join(' ') + '\\n');
} else {
  if (rule.stdout !== undefined) {
    process.stdout.write(rule.stdout);
  }
  if (rule.stderr !== undefined) {
    process.stderr.write(rule.stderr);
  }
}
process.exitCode = exitCode;
`;

function storeRules(rules: readonly FakeRule[] | undefined): unknown[] {
  return (rules ?? []).map((rule) => ({
    ...rule,
    args: rule.args.map((pattern): StoredPattern =>
      typeof pattern === 'string' ? pattern : { re: pattern.source, flags: pattern.flags },
    ),
  }));
}

function launcher(folder: string, tool: 'railway' | 'gh'): string {
  return `#!/bin/sh\nexec "${process.execPath}" "${join(folder, 'shim.mjs')}" ${tool} "$@"\n`;
}

/**
 * Writes `railway` and `gh` shims into a temporary folder; a child process whose PATH starts with
 * that folder (see `env`) gets the scripted answers. An unscripted call exits 97.
 */
export async function createFakeCli(tables: {
  readonly railway?: readonly FakeRule[];
  readonly gh?: readonly FakeRule[];
}): Promise<FakeCli> {
  const folder = await mkdtemp(join(tmpdir(), 'fake-cli-'));
  await writeFile(
    join(folder, 'rules.json'),
    JSON.stringify({ railway: storeRules(tables.railway), gh: storeRules(tables.gh) }),
  );
  await writeFile(join(folder, 'shim.mjs'), SHIM);
  await writeFile(join(folder, 'calls.jsonl'), '');
  for (const tool of ['railway', 'gh'] as const) {
    const path = join(folder, tool);
    await writeFile(path, launcher(folder, tool));
    await chmod(path, 0o755);
  }
  const callsFile = join(folder, 'calls.jsonl');
  return {
    binDir: folder,
    env(base) {
      const result: Record<string, string> = {};
      for (const [name, value] of Object.entries(base)) {
        if (value !== undefined) {
          result[name] = value;
        }
      }
      result.PATH = base.PATH === undefined ? folder : `${folder}:${base.PATH}`;
      return result;
    },
    calls() {
      return readCalls(callsFile);
    },
    async cleanup() {
      await rm(folder, { recursive: true, force: true });
    },
  };
}

function readCalls(file: string): FakeCall[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as FakeCall); // written by the shim above in this shape
}
