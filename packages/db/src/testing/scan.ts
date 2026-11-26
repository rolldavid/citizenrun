import { marker } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { captureLogs } from './logs.ts';

/** The privacy scan found a forbidden value. It names each source and pattern, never the text (D-116). */
export class PrivacyLeakError extends Error {
  override readonly name = 'PrivacyLeakError';
  readonly findings: readonly { source: string; pattern: string }[];

  constructor(findings: readonly { source: string; pattern: string }[]) {
    super(
      `The privacy scan found forbidden values: ${findings
        .map((finding) => `${finding.source} (${finding.pattern})`)
        .join(', ')}`,
    );
    this.findings = findings;
  }
}

type Pattern = { name: string; value: string };
type Text = { source: string; text: string };

const registeredValues: string[] = [];
const registeredSources = new Map<string, () => readonly string[]>();

/** Adds a value the scan looks for until the next test (a token or a coordinate a test made). */
export function registerScanValue(value: string): void {
  registeredValues.push(value);
}

/** Adds a source of texts the scan reads until the next test (a capture mailer's admin emails). */
export function registerScanSource(name: string, read: () => readonly string[]): void {
  registeredSources.set(name, read);
}

/** Forgets every registered value and source; resetDb() calls it before each test. */
export function clearScanRegistrations(): void {
  registeredValues.length = 0;
  registeredSources.clear();
}

// The marker's base64 forms, one per byte alignment of the marker inside the encoded text (0, 1 or
// 2 bytes after a 3-byte group starts): each is the run of characters that stays the same whatever
// comes before and after the marker, that is the groups made of marker bytes only.
export function base64Forms(value: string): [string, string, string] {
  const bytes = Buffer.from(value, 'utf8');
  const form = (offset: number): string => {
    const shifted = Buffer.concat([Buffer.alloc(offset), bytes]);
    const encoded = shifted.toString('base64');
    // Skip the group that holds filler bytes, then keep the whole groups that follow.
    const skipGroups = offset === 0 ? 0 : 1;
    const wholeGroups = Math.floor(shifted.length / 3) - skipGroups;
    return encoded.slice(skipGroups * 4, (skipGroups + wholeGroups) * 4);
  };
  return [form(0), form(1), form(2)];
}

/** The patterns of the always-on scan (TC-48): the marker, its three base64 forms, the fixed five and every registered value. */
export function scanPatterns(markerValue: string, registered: readonly string[]): Pattern[] {
  const [aligned, shiftedOne, shiftedTwo] = base64Forms(markerValue);
  return [
    { name: 'marker', value: markerValue },
    { name: 'marker-base64', value: aligned },
    { name: 'marker-base64-1', value: shiftedOne },
    { name: 'marker-base64-2', value: shiftedTwo },
    { name: 'email', value: '@example.test' },
    { name: 'presigned-url', value: 'X-Amz-Signature' },
    { name: 'bearer', value: 'Bearer ' },
    { name: 'session-cookie', value: 'os_session=' },
    { name: 'admin-session-cookie', value: 'os_admin_session=' },
    ...registered.map((value, index) => ({ name: `registered-${String(index + 1)}`, value })),
  ];
}

/** Each (source, pattern) pair where a text holds a pattern's value; never the text itself. */
export function scanTexts(
  texts: readonly Text[],
  patterns: readonly Pattern[],
): { source: string; pattern: string }[] {
  const findings: { source: string; pattern: string }[] = [];
  for (const { source, text } of texts) {
    for (const pattern of patterns) {
      if (pattern.value !== '' && text.includes(pattern.value)) {
        findings.push({ source, pattern: pattern.name });
      }
    }
  }
  return findings;
}

// The scanned columns of TEST-privacy-logscan, each read only once its table exists. The SQL is
// fixed text: no name in it comes from a test.
const SCANNED: readonly { table: string; source: string; query: SQL }[] = [
  {
    table: 'public.client_errors',
    source: 'client_errors',
    query: sql`select t::text as text from client_errors t`,
  },
  {
    table: 'public.app_events',
    source: 'app_events.props',
    query: sql`select props::text as text from app_events`,
  },
  {
    table: 'public.feed_events',
    source: 'feed_events',
    query: sql`select t::text as text from feed_events t`,
  },
  {
    table: 'public.feed_features',
    source: 'feed_features.features',
    query: sql`select features::text as text from feed_features`,
  },
  {
    table: 'public.notifications',
    source: 'notifications.target',
    query: sql`select target::text as text from notifications`,
  },
];

async function exists(db: Db, table: string): Promise<boolean> {
  const rows = await db.execute<{ present: boolean }>(
    sql`select to_regclass(${table}) is not null as present`,
    'objects',
  );
  return rows[0]?.present === true;
}

async function databaseTexts(db: Db): Promise<Text[]> {
  const texts: Text[] = [];
  if (await exists(db, 'pgboss.job')) {
    const jobs = await db.execute<{ name: string; data: string | null }>(
      sql`select name, data::text as data from pgboss.job`,
      'objects',
    );
    jobs.forEach((job, index) => {
      texts.push({ source: `pgboss.job ${String(index + 1)}`, text: job.data ?? '' });
    });
  }
  for (const scanned of SCANNED) {
    if (!(await exists(db, scanned.table))) {
      continue;
    }
    const rows = await db.execute<{ text: string | null }>(scanned.query, 'objects');
    rows.forEach((row, index) => {
      texts.push({ source: `${scanned.source} row ${String(index + 1)}`, text: row.text ?? '' });
    });
  }
  return texts;
}

/**
 * The always-on privacy scan (TC-48), run after every integration test: every captured log line,
 * every pg-boss job's data, every registered source and the scanned columns are checked for the
 * patterns of scanPatterns(). Throws PrivacyLeakError naming each source and pattern found.
 */
export async function scanForLeaks(db: Db): Promise<void> {
  const texts: Text[] = captureLogs().lines.map((line, index) => ({
    source: `log line ${String(index + 1)}`,
    text: line.raw,
  }));
  texts.push(...(await databaseTexts(db)));
  for (const [name, read] of registeredSources) {
    read().forEach((text, index) => {
      texts.push({ source: `${name} ${String(index + 1)}`, text });
    });
  }
  const findings = scanTexts(texts, scanPatterns(marker(), registeredValues));
  if (findings.length > 0) {
    throw new PrivacyLeakError(findings);
  }
}
