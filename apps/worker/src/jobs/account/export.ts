import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dataExports, users } from '@citizenrun/db';
import { BRAND, EXPORT_FILE_TTL_MS } from '@citizenrun/shared';
import { exportKey } from '@citizenrun/shared/storage';
import { and, eq } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { deleteKeys, putObject } from '../../lib/bucket-ops.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import { PermanentJobError } from '../types.ts';
import type { JobDefinition } from '../types.ts';
import { buildExportFile } from './export-file.ts';

// Marks a queued export failed; an export that left `queued` is left as it is.
async function markFailed(ctx: JobContext, exportId: string): Promise<void> {
  await ctx.db
    .update(dataExports)
    .set({ status: 'failed' })
    .where(and(eq(dataExports.id, exportId), eq(dataExports.status, 'queued')));
}

// The export of an account being deleted, or gone: its file goes, if one was written, and the row
// ends `failed`. The file goes first, so a retry after a failed delete still finds the row queued.
async function discard(ctx: JobContext, userId: string, exportId: string): Promise<void> {
  await deleteKeys(ctx.storage.media, [exportKey(userId, exportId)], { signal: ctx.signal });
  await markFailed(ctx, exportId);
}

// Writes the file through a temporary folder and uploads it; returns its size in bytes.
async function uploadExport(
  ctx: JobContext,
  key: string,
  json: string,
  now: Date,
): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'export-'));
  try {
    const path = join(dir, 'export.json');
    await writeFile(path, json, 'utf8');
    const { size } = await stat(path);
    const date = now.toISOString().slice(0, 10);
    await putObject(
      ctx.storage.media,
      key,
      createReadStream(path),
      {
        contentType: 'application/json',
        contentDisposition: `attachment; filename="${BRAND.slug}-export-${date}.json"`,
        cacheControl: 'private, no-store',
        contentLength: size,
      },
      ctx.signal,
    );
    return size;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * J-account.export: writes one queued export as an ExportFile to `exports/<user id>/<export id>.json`
 * in `media` and marks it ready for EXPORT_FILE_TTL_MS. An export of an account being deleted ends
 * `failed`; on the last attempt a retryable error marks it `failed` before it is rethrown. No link
 * to the file is ever emailed or logged; the one log line holds the size.
 */
export const accountExport: JobDefinition<'account.export'> = {
  name: 'account.export',
  queue: QUEUE_OPTIONS['account.export'].queue,
  work: QUEUE_OPTIONS['account.export'].work,
  async handle(payload, ctx) {
    const { exportId } = payload;
    const [row] = await ctx.db
      .select({ id: dataExports.id, userId: dataExports.userId, status: dataExports.status })
      .from(dataExports)
      .where(eq(dataExports.id, exportId));
    if (row === undefined || row.status !== 'queued') {
      return;
    }
    const [user] = await ctx.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, row.userId));
    if (user === undefined || user.status === 'deleting') {
      await discard(ctx, row.userId, exportId);
      return;
    }

    try {
      const now = ctx.now();
      const file = await buildExportFile(ctx.db, ctx.storage.media, row.userId, now);
      await ctx.touch();
      const key = exportKey(row.userId, exportId);
      const bytes = await uploadExport(ctx, key, JSON.stringify(file), now);
      // The account is read again with its row held, so a deletion asked for during the upload
      // either comes first and the file goes, or waits until the export is ready and J-account.delete
      // then removes the file with the rest.
      const ready = await ctx.db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, row.userId))
          .for('share');
        if (owner === undefined || owner.status === 'deleting') {
          return false;
        }
        await tx
          .update(dataExports)
          .set({
            status: 'ready',
            objectKey: key,
            readyAt: now,
            expiresAt: new Date(now.getTime() + EXPORT_FILE_TTL_MS),
          })
          .where(and(eq(dataExports.id, exportId), eq(dataExports.status, 'queued')));
        return true;
      });
      if (!ready) {
        await discard(ctx, row.userId, exportId);
        return;
      }
      ctx.log.info('account.exported', { bytes });
    } catch (error) {
      if (ctx.job.isFinalAttempt && !(error instanceof PermanentJobError)) {
        await markFailed(ctx, exportId);
      }
      throw error;
    }
  },
};
