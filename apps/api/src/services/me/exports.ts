import type { S3Client } from '@aws-sdk/client-s3';
import { dataExports } from '@citizenrun/db';
import type { DataExportRow, Db, Tx } from '@citizenrun/db';
import { ApiError, EXPORT_LINK_TTL_S, EXPORTS_PER_DAY, newId, uuidFloor } from '@citizenrun/shared';
import type { DataExportStatus, DataExportView, ExportDownload } from '@citizenrun/shared';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { enqueueOf } from '../../deps.ts';
import { exportDownloadUrl } from '../../lib/storage.ts';

// The one-a-day rule counts the rows of the last 24 hours (D-240).
const DAY_MS = 24 * 60 * 60 * 1000;
const SECOND_MS = 1000;

// A ready row whose file has passed its expiry is reported as expired, whatever its stored status.
function statusOf(row: DataExportRow, now: Date): DataExportView['status'] {
  if (row.status === 'ready' && row.expiresAt !== null && row.expiresAt <= now) {
    return 'expired';
  }
  switch (row.status) {
    case 'queued':
    case 'ready':
    case 'failed':
    case 'expired':
      return row.status;
    default:
      // The check constraint data_exports_status_check allows only the four values above.
      throw new Error('A data_exports row holds an unknown status.');
  }
}

function toView(row: DataExportRow, now: Date): DataExportView {
  return {
    id: row.id,
    status: statusOf(row, now),
    requestedAt: row.createdAt.toISOString(),
    readyAt: row.readyAt === null ? null : row.readyAt.toISOString(),
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
  };
}

async function newestExport(db: Db | Tx, userId: string): Promise<DataExportRow | null> {
  // index: data_exports_user
  const [row] = await db
    .select()
    .from(dataExports)
    .where(eq(dataExports.userId, userId))
    .orderBy(desc(dataExports.id))
    .limit(1);
  return row ?? null;
}

/**
 * E-ME-04: queues one export and enqueues account.export with its id, in one transaction. A second
 * request within 24 hours answers 429 `daily_limit_reached`, with `Retry-After` the seconds until
 * the oldest counted request is 24 hours old (at least 1).
 */
export async function requestExport(
  deps: Deps,
  input: { userId: string; now: Date },
): Promise<DataExportView> {
  const { db } = deps;
  const { userId, now } = input;
  // index: data_exports_user
  const [counted] = await db
    .select({
      n: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${dataExports.createdAt})`.mapWith(dataExports.createdAt),
    })
    .from(dataExports)
    .where(
      and(
        eq(dataExports.userId, userId),
        gte(dataExports.id, uuidFloor(new Date(now.getTime() - DAY_MS))),
      ),
    );
  if (counted !== undefined && counted.n >= EXPORTS_PER_DAY && counted.oldest !== null) {
    const waitMs = counted.oldest.getTime() + DAY_MS - now.getTime();
    throw new ApiError('daily_limit_reached', {
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / SECOND_MS)),
    });
  }

  const enqueue = enqueueOf(deps);
  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(dataExports)
      .values({ id: newId(), userId, status: 'queued' })
      .returning();
    if (inserted === undefined) {
      throw new Error('The data_exports insert returned no row.');
    }
    await enqueue('account.export', { exportId: inserted.id }, { tx });
    return inserted;
  });
  return toView(row, now);
}

/**
 * E-ME-05: the newest export request (a ready one past its expiry reported as expired) and when
 * another may be asked for; both null when the user never asked.
 */
export async function getExportStatus(
  db: Db | Tx,
  input: { userId: string; now: Date },
): Promise<DataExportStatus> {
  const { userId, now } = input;
  const row = await newestExport(db, userId);
  if (row === null) {
    return { export: null, nextRequestAt: null };
  }
  const nextRequestAt = new Date(row.createdAt.getTime() + DAY_MS);
  return {
    export: toView(row, now),
    nextRequestAt: nextRequestAt > now ? nextRequestAt.toISOString() : null,
  };
}

/**
 * E-ME-06: a 300-second link to the newest export's file when it is ready and unexpired. No
 * request, or a failed or expired one: 404 `not_found`; a queued one: 409 `export_not_ready`. The
 * link is never logged.
 */
export async function getExportDownload(
  db: Db | Tx,
  input: { userId: string; now: Date },
  media: { client: S3Client; bucket: string },
): Promise<ExportDownload> {
  const { userId, now } = input;
  const row = await newestExport(db, userId);
  if (row === null) {
    throw new ApiError('not_found');
  }
  const status = statusOf(row, now);
  if (status === 'queued') {
    throw new ApiError('export_not_ready');
  }
  if (status !== 'ready' || row.objectKey === null || row.readyAt === null) {
    throw new ApiError('not_found');
  }
  return {
    url: await exportDownloadUrl(media.client, media.bucket, row.objectKey, row.readyAt, now),
    expiresAt: new Date(now.getTime() + EXPORT_LINK_TTL_S * SECOND_MS).toISOString(),
  };
}
