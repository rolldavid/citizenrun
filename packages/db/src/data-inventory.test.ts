import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema/index.ts';
import * as partitioned from './schema/partitioned.ts';

// CTL-23: the public data inventory names every table, storage location and outside host.

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const INVENTORY = join(REPO_ROOT, 'docs/data-inventory.md');

// The two services' outbound host lists, read as text: a package never imports from an app.
const WORKER_OUTBOUND = join(REPO_ROOT, 'apps/worker/src/lib/outbound-fetch.ts');
const API_OUTBOUND = join(REPO_ROOT, 'apps/api/src/lib/outbound-fetch.ts');

const CLASSES = [
  'public-civic',
  'public',
  'private',
  'sensitive',
  'restricted',
  'secret',
  'pseudonymous',
  'operational',
] as const;

// Every key prefix the services write. Each prefix added later is added here and to the file.
const STORAGE_LOCATIONS = [
  'media/incoming/',
  'media/avatars/',
  'media/exports/',
  'backups/pg/',
  'backups/replay/deletions/',
] as const;

const PLAN_CITATIONS: readonly RegExp[] = [
  /plans\//,
  /contracts\//,
  /\b[DR]-\d{3}\b/,
  /\b[TP]:\d+/,
  /\bmilestone \d+/i,
  /\bM\d{2}-S\d/,
];

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

type Row = { cells: Record<string, string>; name: string | null; line: string };

/** The backticked tokens of a cell. */
function ticked(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? '');
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** The rows of the first pipe table under `## <heading>`, keyed by the header's cell texts. */
function tableUnder(text: string, heading: string): Row[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(`the inventory has no "## ${heading}" section`);
  }
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) {
      break;
    }
    section.push(line);
  }
  const tableLines = section.filter((line) => line.trim().startsWith('|'));
  const [header, separator, ...body] = tableLines;
  if (header === undefined || separator === undefined || !/^\|[\s:|-]+\|$/.test(separator.trim())) {
    throw new Error(`the "## ${heading}" section holds no pipe table`);
  }
  const columns = splitRow(header);
  return body.map((line) => {
    const values = splitRow(line);
    const cells: Record<string, string> = {};
    columns.forEach((column, index) => {
      cells[column] = values[index] ?? '';
    });
    return { cells, name: ticked(values[0] ?? '')[0] ?? null, line };
  });
}

/** The names of every Drizzle table the schema exports, the typing-only partitioned file included. */
function schemaTableNames(): string[] {
  const names = new Set<string>();
  for (const value of [...Object.values(schema), ...Object.values(partitioned)]) {
    if (is(value, PgTable)) {
      names.add(getTableName(value));
    }
  }
  return [...names].sort();
}

/**
 * The host literals of a file's `OUTBOUND_HOSTS` declaration: the text from the declaration to
 * the end of the line that closes it, and every single-quoted string in it that reads as a host.
 */
function outboundHostLiterals(source: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /\bOUTBOUND_HOSTS\b[^=]*=/.test(line));
  if (start === -1) {
    throw new Error('no OUTBOUND_HOSTS declaration');
  }
  const declaration: string[] = [];
  let depth = 0;
  let opened = false;
  for (const line of lines.slice(start)) {
    declaration.push(line);
    for (const char of line) {
      if (char === '{' || char === '[' || char === '(') {
        depth += 1;
        opened = true;
      } else if (char === '}' || char === ']' || char === ')') {
        depth -= 1;
      }
    }
    if ((opened && depth <= 0) || (!opened && line.trimEnd().endsWith(';'))) {
      break;
    }
  }
  return [...declaration.join('\n').matchAll(/'([^'\\]*)'/g)]
    .map((match) => match[1] ?? '')
    .filter((value) => HOST.test(value));
}

function classOk(cell: string): boolean {
  const parts = cell.split(', ');
  return parts.length > 0 && parts.every((part) => (CLASSES as readonly string[]).includes(part));
}

const inventory = readFileSync(INVENTORY, 'utf8');

describe('the data inventory', () => {
  it('every table of the schema has a row with a class and a retention', () => {
    const tables = schemaTableNames();
    expect(tables.length).toBeGreaterThan(0);
    const rows = tableUnder(inventory, 'Tables');
    const byName = new Map(rows.map((row) => [row.name, row]));
    for (const table of tables) {
      const row = byName.get(table);
      expect(row, `no row for the table ${table}`).toBeDefined();
      expect(classOk(row?.cells.Class ?? ''), `the class of ${table}`).toBe(true);
      expect(row?.cells['Kept for'] ?? '', `the retention of ${table}`).not.toBe('');
    }
    for (const row of rows) {
      expect(tables, `a row names no table of the schema: ${row.line}`).toContain(row.name);
    }
    expect(rows).toHaveLength(tables.length);
  });

  it('every storage location has a row', () => {
    const rows = tableUnder(inventory, 'Storage locations');
    const byName = new Map(rows.map((row) => [row.name, row]));
    for (const location of STORAGE_LOCATIONS) {
      const row = byName.get(location);
      expect(row, `no row for the location ${location}`).toBeDefined();
      expect(classOk(row?.cells.Class ?? ''), `the class of ${location}`).toBe(true);
      expect(row?.cells['Kept for'] ?? '', `the retention of ${location}`).not.toBe('');
    }
    expect(rows.map((row) => row.name).sort()).toEqual([...STORAGE_LOCATIONS].sort());
  });

  it('every outbound host maps to a processor row', () => {
    expect(existsSync(WORKER_OUTBOUND)).toBe(true);
    const files = [WORKER_OUTBOUND, ...(existsSync(API_OUTBOUND) ? [API_OUTBOUND] : [])];
    const hosts = files.flatMap((file) => outboundHostLiterals(readFileSync(file, 'utf8')));
    expect(hosts.length).toBeGreaterThan(0);
    const listed = new Set(
      tableUnder(inventory, 'Processors').flatMap((row) => ticked(row.cells.Hosts ?? '')),
    );
    for (const host of hosts) {
      expect(listed.has(host), `no processor row lists ${host}`).toBe(true);
    }
  });

  it('the file cites no plan document', () => {
    for (const pattern of PLAN_CITATIONS) {
      expect(inventory, `the inventory matches ${String(pattern)}`).not.toMatch(pattern);
    }
  });

  it('lists the eight classes', () => {
    expect(tableUnder(inventory, 'Classes').map((row) => row.name)).toEqual([...CLASSES]);
  });

  it('reads the host literals of a declaration and nothing after it', () => {
    const source = [
      "import { x } from './a.ts';",
      'export const OUTBOUND_HOSTS = {',
      "  resend: 'api.resend.com',",
      "  apple: 'appleid.apple.com', // 'not a host'",
      '} as const;',
      "const OTHER = 'example.test';",
    ].join('\n');
    expect(outboundHostLiterals(source)).toEqual(['api.resend.com', 'appleid.apple.com']);
    expect(
      outboundHostLiterals(
        "export const OUTBOUND_HOSTS = { a: 'api.resend.com' } as const;\nconst B = 'x.test';",
      ),
    ).toEqual(['api.resend.com']);
  });
});
