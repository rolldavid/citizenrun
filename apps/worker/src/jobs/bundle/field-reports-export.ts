import { gzipSync } from 'node:zlib';
import { fieldReports, offices } from '@citizenrun/db';
import { FieldReportExportRowSchema } from '@citizenrun/shared';
import type { FieldReportExportRow } from '@citizenrun/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { putObject } from '../../lib/bucket-ops.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';

// J-field-reports.export: open field reports go to the `data` bucket for the pipeline with their
// office, field and link, never the user or the message (D-405).

/** Where the export files live in the `data` bucket (PIPE-bucket-layout). */
export const FIELD_REPORTS_PREFIX = 'field-reports/';

/** `field-reports/<UTC YYYY-MM-DD>/<jobId>.ndjson.gz`: a retry of the job overwrites its own file. */
export function exportKey(now: Date, jobId: string): string {
  return `${FIELD_REPORTS_PREFIX}${now.toISOString().slice(0, 10)}/${jobId}.ndjson.gz`;
}

/**
 * Selects the open reports not yet exported, writes the valid ones as gzipped NDJSON under the
 * job's key, then marks them exported. A row that fails FieldReportExportRowSchema is left
 * unexported and logged by id only.
 */
export const fieldReportsExport: JobDefinition<'field-reports.export'> = {
  name: 'field-reports.export',
  queue: QUEUE_OPTIONS['field-reports.export'].queue,
  work: QUEUE_OPTIONS['field-reports.export'].work,
  async handle(_payload, ctx) {
    // Read once: the key's date and exported_at are the same instant.
    const now = ctx.now();
    // index: field_reports_queue. The columns are named: user_id and message never leave the table.
    const rows = await ctx.db
      .select({
        id: fieldReports.id,
        slug: offices.slug,
        field: fieldReports.field,
        sourceUrl: fieldReports.sourceUrl,
        createdAt: fieldReports.createdAt,
      })
      .from(fieldReports)
      .innerJoin(offices, eq(offices.id, fieldReports.officeId))
      .where(and(eq(fieldReports.status, 'open'), isNull(fieldReports.exportedAt)))
      .orderBy(asc(fieldReports.id));

    const valid: FieldReportExportRow[] = [];
    for (const row of rows) {
      const parsed = FieldReportExportRowSchema.safeParse({
        report_id: row.id,
        office_slug: row.slug,
        field: row.field,
        source_url: row.sourceUrl,
        created_at: row.createdAt.toISOString(),
      });
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        ctx.log.warn('field_reports.export_row_invalid', { reportId: row.id });
      }
    }
    if (valid.length === 0) {
      ctx.log.info('field_reports.exported', { count: 0 });
      return;
    }

    const ndjson = valid.map((row) => `${JSON.stringify(row)}\n`).join('');
    await putObject(
      ctx.storage.data,
      exportKey(now, ctx.job.id),
      gzipSync(ndjson),
      { contentType: 'application/gzip' },
      ctx.signal,
    );

    const ids = valid.map((row) => row.report_id);
    await ctx.db
      .update(fieldReports)
      .set({ exportedAt: now })
      .where(
        and(
          sql`${fieldReports.id} = any(${sql.param(ids)}::uuid[])`,
          isNull(fieldReports.exportedAt),
        ),
      );
    ctx.log.info('field_reports.exported', { count: valid.length });
  },
};
