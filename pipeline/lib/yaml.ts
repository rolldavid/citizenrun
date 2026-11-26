// YAML files under data/: parsed strictly, validated with zod, and reported by file, path and line.
// No message ever carries a value from the file.
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { LineCounter, isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import type { Document, Node } from 'yaml';
import type { z } from 'zod';
import { repoRoot } from './paths.ts';

/** A data file that does not parse or does not match its schema. The message lists every problem. */
export class DataFileError extends Error {
  override readonly name = 'DataFileError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join('\n'));
    this.problems = problems;
  }
}

type Parsed = { doc: Document.Parsed; lines: LineCounter };

function lineOf(lines: LineCounter, offset: number): number {
  return lines.linePos(offset).line;
}

function parse(text: string, fileLabel: string): Parsed {
  const lines = new LineCounter();
  const doc = parseDocument(text, {
    uniqueKeys: true,
    prettyErrors: true,
    strict: true,
    lineCounter: lines,
  });
  // A warning (an unresolved or custom tag among them) is refused like an error.
  const problems = [...doc.errors, ...doc.warnings].map((problem) => {
    const line = problem.linePos?.[0].line ?? lineOf(lines, problem.pos[0]);
    return `${fileLabel}: line ${String(line)}: ${problem.code}`;
  });
  if (problems.length > 0) {
    throw new DataFileError(problems);
  }
  return { doc, lines };
}

/** Parses one YAML document with the core schema and no custom tags. Throws DataFileError. */
export function parseYaml(text: string, fileLabel: string): unknown {
  return parse(text, fileLabel).doc.toJS();
}

/** `a.b[2].c` for a zod issue path. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') {
      out += `[${String(part)}]`;
    } else {
      const name = String(part);
      out += out === '' ? name : `.${name}`;
    }
  }
  return out === '' ? '(root)' : out;
}

/** The line of the node at `path`, or of the nearest node above it that exists. */
function lineAt(parsed: Parsed, path: readonly PropertyKey[]): number {
  let node: unknown = parsed.doc.contents;
  let line = 1;
  const nodeLine = (n: unknown): number | null => {
    const range = (n as Node | null)?.range;
    return range === undefined || range === null ? null : lineOf(parsed.lines, range[0]);
  };
  line = nodeLine(node) ?? line;
  for (const part of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (item) => isPair(item) && isScalar(item.key) && String(item.key.value) === String(part),
      );
      if (pair === undefined) {
        break;
      }
      line = nodeLine(pair.key) ?? line;
      node = pair.value;
      line = nodeLine(node) ?? line;
    } else if (isSeq(node) && typeof part === 'number') {
      const item = node.items[part];
      if (item === undefined) {
        break;
      }
      node = item;
      line = nodeLine(node) ?? line;
    } else {
      break;
    }
  }
  return line;
}

/** Validates YAML text against `schema`; every zod issue becomes `<file>: <path> (line N): <message>`. */
export function parseYamlWith<T>(text: string, fileLabel: string, schema: z.ZodType<T>): T {
  const parsed = parse(text, fileLabel);
  const result = schema.safeParse(parsed.doc.toJS());
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.flatMap((issue) => {
    // An unknown key is reported at the key itself.
    const paths: PropertyKey[][] =
      issue.code === 'unrecognized_keys'
        ? issue.keys.map((key) => [...issue.path, key])
        : [[...issue.path]];
    return paths.map(
      (path) =>
        `${fileLabel}: ${formatPath(path)} (line ${String(lineAt(parsed, path))}): ${issue.message}`,
    );
  });
  throw new DataFileError(problems);
}

/** The label a file is reported by: its path from the repository root when it is inside it. */
function labelFor(path: string): string {
  const fromRoot = relative(repoRoot(), path);
  return fromRoot.startsWith('..') || isAbsolute(fromRoot) ? path : fromRoot;
}

/** Reads, parses and validates a YAML file. Throws DataFileError with every issue. */
export async function readYamlFile<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const text = await readFile(path, 'utf8');
  return parseYamlWith(text, labelFor(path), schema);
}
