import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY, SCHEDULE_REGISTRY } from './queues.ts';

const SRC = import.meta.dirname;
const JOBS = join(SRC, 'jobs');
const JOB_TYPES = join(JOBS, 'types.ts');
// This file holds the forbidden shapes below as fixtures for the scanner, so the scan skips it.
const THIS_FILE = join(SRC, 'foundation.test.ts');

function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts');
}

/** Every `.ts` file under `dir`, recursively, sorted. */
function tsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...tsFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found.sort();
}

/** The handler files under jobs/: every `.ts` file but tests and jobs/types.ts. */
function handlerFiles(): string[] {
  return tsFiles(JOBS).filter((path) => !isTestFile(path) && path !== JOB_TYPES);
}

/** The test files beside a handler file that exist: `<name>.test.ts` and `<name>.int.test.ts`. */
function testFilesOf(path: string): string[] {
  const stem = path.slice(0, -'.ts'.length);
  return [`${stem}.test.ts`, `${stem}.int.test.ts`].filter((candidate) => existsSync(candidate));
}

/** The handler file that defines the job `name`: it declares `JobDefinition<'<name>'>` and that name. */
function sourceOf(name: string): string[] {
  return handlerFiles().filter((path) => {
    const text = readFileSync(path, 'utf8');
    return text.includes(`JobDefinition<'${name}'>`) && text.includes(`name: '${name}'`);
  });
}

const IDEMPOTENT_CASE = /\bit\(\s*(['"`])is idempotent\1/;

// The arguments of a call whose opening parenthesis is at `open`, split at top-level commas.
function callArguments(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) {
        args.push(text.slice(start, index));
        break;
      }
    } else if (character === ',' && depth === 1) {
      args.push(text.slice(start, index));
      start = index + 1;
    }
  }
  return args.map((arg) => arg.trim()).filter((arg) => arg !== '');
}

const CHILD_PROCESS_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g;
const CHILD_PROCESS_NAMESPACE =
  /import\s*\*\s*as\s*(\w+)\s*from\s*['"](?:node:)?child_process['"]/g;
const SHELL_OPTION = /\bshell\s*:(?!\s*false\b)/;
const SPAWN_CALL = /\bspawn(?:Sync)?\s*\(/g;
const ARGUMENT_ARRAY = /^(?:\[|[A-Za-z_$][\w$]*$)/;

/**
 * What a source file does that could run a command through a shell: importing `exec`,
 * `execSync`, `execFile` or `execFileSync` from child_process, calling one through a namespace
 * import, passing a `shell` option other than false, or calling `spawn` without an argument array.
 */
function shellUses(text: string): string[] {
  const problems: string[] = [];
  for (const match of text.matchAll(CHILD_PROCESS_IMPORT)) {
    const names = (match[1] ?? '').split(',').map((name) => name.trim().split(/\s+/)[0] ?? '');
    for (const name of names) {
      if (/^exec(?:Sync|File|FileSync)?$/.test(name)) {
        problems.push(`imports ${name}`);
      }
    }
  }
  for (const match of text.matchAll(CHILD_PROCESS_NAMESPACE)) {
    const namespace = match[1] ?? '';
    if (new RegExp(`\\b${namespace}\\.exec(?:Sync|File|FileSync)?\\s*\\(`).test(text)) {
      problems.push(`calls exec through ${namespace}`);
    }
  }
  if (SHELL_OPTION.test(text)) {
    problems.push('passes a shell option');
  }
  for (const match of text.matchAll(SPAWN_CALL)) {
    const args = callArguments(text, match.index + match[0].length - 1);
    const second = args[1];
    if (second === undefined || !ARGUMENT_ARRAY.test(second)) {
      problems.push('calls spawn without an argument array');
    }
  }
  return problems;
}

describe('worker foundation', () => {
  it('every job has a test', () => {
    const files = handlerFiles();
    expect(files.length).toBeGreaterThan(0);
    const missing = files
      .filter((path) => testFilesOf(path).length === 0)
      .map((path) => relative(SRC, path));
    expect(missing).toEqual([]);
  });

  it('every job runs twice safely', () => {
    expect(QUEUE_REGISTRY.length).toBeGreaterThan(0);
    for (const definition of QUEUE_REGISTRY) {
      const sources = sourceOf(definition.name);
      expect(sources, definition.name).toHaveLength(1);
      const tests = testFilesOf(sources[0] ?? '');
      const hasCase = tests.some((path) => IDEMPOTENT_CASE.test(readFileSync(path, 'utf8')));
      expect(hasCase, `${definition.name} has a case named "is idempotent"`).toBe(true);
    }
  });

  it('ffmpeg runs without a shell', () => {
    const problems = tsFiles(SRC)
      .filter((path) => path !== THIS_FILE)
      .flatMap((path) =>
        shellUses(readFileSync(path, 'utf8')).map(
          (problem) => `${relative(SRC, path)}: ${problem}`,
        ),
      );
    expect(problems).toEqual([]);
  });

  it('the shell scan finds each forbidden shape', () => {
    expect(shellUses("import { exec } from 'node:child_process';")).toEqual(['imports exec']);
    expect(shellUses("import { spawn, execSync as run } from 'child_process';")).toEqual([
      'imports execSync',
    ]);
    expect(
      shellUses("import * as cp from 'node:child_process'; cp.execFile('ffmpeg', [], {});"),
    ).toEqual(['calls exec through cp']);
    expect(shellUses("spawn('ffmpeg', ['-i', input], { shell: true });")).toEqual([
      'passes a shell option',
    ]);
    expect(shellUses("spawn('ffmpeg -i input.mov');")).toEqual([
      'calls spawn without an argument array',
    ]);
    expect(shellUses('spawn(`ffmpeg ${flags}`, { timeout: 1000 });')).toEqual([
      'calls spawn without an argument array',
    ]);
    expect(shellUses("spawn('ffprobe', ['-v', 'error', path], { timeout: 1000 });")).toEqual([]);
    expect(shellUses("spawn('ffmpeg', args, { shell: false, timeout: 1000 });")).toEqual([]);
    expect(shellUses('const match = PATTERN.exec(text);')).toEqual([]);
  });

  it('every scheduled queue is in the registry', () => {
    const names = new Set<string>(QUEUE_REGISTRY.map((definition) => definition.name));
    expect(SCHEDULE_REGISTRY.length).toBeGreaterThan(0);
    for (const entry of SCHEDULE_REGISTRY) {
      expect(names.has(entry.queue), entry.id).toBe(true);
    }
  });
});
