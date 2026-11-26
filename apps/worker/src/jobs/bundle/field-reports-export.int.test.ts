import { gunzipSync } from 'node:zlib';
import { fieldReports } from '@citizenrun/db';
import {
  captureLogs,
  getTestDb,
  getTestObject,
  insertFieldReport,
  insertUser,
  listTestKeys,
  resetStorage,
} from '@citizenrun/db/testing';
import { FieldReportExportRowSchema, newId } from '@citizenrun/shared';
import { FakeClock, marker } from '@citizenrun/shared/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { runJob } from '../../testing/job.ts';
import { FIELD_REPORTS_PREFIX, exportKey, fieldReportsExport } from './field-reports-export.ts';

// TEST-field-reports, the worker half: open reports leave for the pipeline with their office,
// field and link, never the user or the message.

const NOW = '2027-03-05T05:30:00.000Z';
const ROW_KEYS = ['created_at', 'field', 'office_slug', 'report_id', 'source_url'];

async function exportedAt(id: string): Promise<Date | null> {
  const [row] = await getTestDb()
    .select({ exportedAt: fieldReports.exportedAt })
    .from(fieldReports)
    .where(eq(fieldReports.id, id));
  return row?.exportedAt ?? null;
}

function lines(bytes: Uint8Array): unknown[] {
  return gunzipSync(bytes)
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

function exportedLines(): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === 'field_reports.exported')
    .map((line) => line.parsed);
}

describe('J-field-reports.export', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  it('exports open reports without the user', async () => {
    const clock = new FakeClock(NOW);
    const first = await insertFieldReport(getTestDb(), {
      field: 'filing_fee',
      sourceUrl: 'https://elections.example.test/fees',
      message: `The fee changed ${marker()}`,
    });
    const second = await insertFieldReport(getTestDb(), { message: null });
    const jobId = newId();
    const result = await runJob(fieldReportsExport, {}, { clock, jobId });
    expect(result.outcome).toBe('completed');

    const key = exportKey(new Date(NOW), jobId);
    expect(key).toBe(`field-reports/2027-03-05/${jobId}.ndjson.gz`);
    expect(await listTestKeys('data', FIELD_REPORTS_PREFIX)).toEqual([key]);
    const bytes = await getTestObject('data', key);
    if (bytes === null) {
      throw new Error('The export file is missing.');
    }
    const rows = lines(bytes);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(FieldReportExportRowSchema.safeParse(row).success).toBe(true);
      expect(Object.keys(row as object).sort()).toEqual(ROW_KEYS);
    }
    const byId = new Map(rows.map((row) => [(row as { report_id: string }).report_id, row]));
    expect(byId.get(first.id)).toMatchObject({
      field: 'filing_fee',
      source_url: 'https://elections.example.test/fees',
      created_at: first.createdAt.toISOString(),
    });
    expect(byId.get(second.id)).toMatchObject({ field: null, source_url: null });

    const text = gunzipSync(bytes).toString('utf8');
    for (const userId of [first.userId, second.userId]) {
      expect(userId).not.toBeNull();
      expect(text).not.toContain(userId ?? '');
    }
    expect(text).not.toContain(marker());
    expect(text).not.toContain('The fee changed');
    expect(Buffer.from(bytes).toString('latin1')).not.toContain(marker());

    expect(await exportedAt(first.id)).toEqual(new Date(NOW));
    expect(await exportedAt(second.id)).toEqual(new Date(NOW));
    expect(exportedLines().at(-1)).toMatchObject({ count: 2 });
  });

  it('a decided report is not exported', async () => {
    const decider = await insertUser(getTestDb(), { role: 'admin' });
    const decided = await insertFieldReport(getTestDb(), {
      status: 'rejected',
      decidedBy: decider.id,
      decidedAt: new Date('2027-03-01T00:00:00Z'),
    });
    const open = await insertFieldReport(getTestDb());
    const result = await runJob(fieldReportsExport, {}, { clock: new FakeClock(NOW) });
    expect(result.outcome).toBe('completed');
    const [key] = await listTestKeys('data', FIELD_REPORTS_PREFIX);
    const bytes = key === undefined ? null : await getTestObject('data', key);
    expect(bytes).not.toBeNull();
    const ids = lines(bytes ?? new Uint8Array()).map(
      (row) => (row as { report_id: string }).report_id,
    );
    expect(ids).toEqual([open.id]);
    expect(await exportedAt(decided.id)).toBeNull();
  });

  it('an exported report is not exported again', async () => {
    await insertFieldReport(getTestDb());
    const clock = new FakeClock(NOW);
    expect((await runJob(fieldReportsExport, {}, { clock })).outcome).toBe('completed');
    const after = await listTestKeys('data', FIELD_REPORTS_PREFIX);
    expect(after).toHaveLength(1);

    expect((await runJob(fieldReportsExport, {}, { clock })).outcome).toBe('completed');
    expect(await listTestKeys('data', FIELD_REPORTS_PREFIX)).toEqual(after);
    expect(exportedLines().at(-1)).toMatchObject({ count: 0 });
  });

  it('nothing to export writes nothing', async () => {
    const result = await runJob(fieldReportsExport, {}, { clock: new FakeClock(NOW) });
    expect(result.outcome).toBe('completed');
    expect(await listTestKeys('data', FIELD_REPORTS_PREFIX)).toEqual([]);
    expect(exportedLines().at(-1)).toMatchObject({ count: 0 });
  });

  it('is idempotent', async () => {
    await insertFieldReport(getTestDb());
    const clock = new FakeClock(NOW);
    const jobId = newId();
    expect((await runJob(fieldReportsExport, {}, { clock, jobId })).outcome).toBe('completed');
    const key = exportKey(new Date(NOW), jobId);
    const before = await getTestObject('data', key);
    expect(before).not.toBeNull();

    expect((await runJob(fieldReportsExport, {}, { clock, jobId })).outcome).toBe('completed');
    expect(await listTestKeys('data', FIELD_REPORTS_PREFIX)).toEqual([key]);
    expect(await getTestObject('data', key)).toEqual(before);
  });

  it('a row that fails the schema stays unexported and is logged by id', async () => {
    const bad = await insertFieldReport(getTestDb(), { field: 'Not A Field' });
    const good = await insertFieldReport(getTestDb());
    const result = await runJob(fieldReportsExport, {}, { clock: new FakeClock(NOW) });
    expect(result.outcome).toBe('completed');
    const [key] = await listTestKeys('data', FIELD_REPORTS_PREFIX);
    const bytes = key === undefined ? null : await getTestObject('data', key);
    const ids = lines(bytes ?? new Uint8Array()).map(
      (row) => (row as { report_id: string }).report_id,
    );
    expect(ids).toEqual([good.id]);
    expect(await exportedAt(bad.id)).toBeNull();
    const invalid = captureLogs().lines.filter(
      (line) => line.parsed.event === 'field_reports.export_row_invalid',
    );
    expect(invalid.map((line) => line.parsed.reportId)).toEqual([bad.id]);
    expect(invalid.some((line) => line.raw.includes('Not A Field'))).toBe(false);
  });
});
