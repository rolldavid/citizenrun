import { fieldReports } from '@citizenrun/db';
import { ApiError, LIMITS, isFirstDay, newId, parseSafeUrl, uuidFloor } from '@citizenrun/shared';
import type { FieldReportInput } from '@citizenrun/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import type { Viewer } from '../../middleware/session.ts';
import { liveOffice } from './office-toggles.ts';

// E-OFF-09 (D-474): a report is stored and nothing else happens. The link is checked as
// text and never requested (INV-39); no civic column changes (INV-29); the note and the link are
// never logged.

// The daily window (D-240), in milliseconds and seconds as the clock counts them.
const SECOND_MS = 1000;
const WINDOW_MS = 24 * 60 * 60 * SECOND_MS;

/** The milliseconds a version 7 uuid holds in its first 48 bits. */
function uuidTimeMs(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/** E-OFF-09: stores one open report about an office, or a field of it, from the viewer. */
export async function createFieldReport(
  deps: Deps,
  input: { viewer: Viewer; officeId: string; body: FieldReportInput; now: Date },
): Promise<{ id: string }> {
  const { viewer, officeId, body, now } = input;
  let sourceUrl: string | null = null;
  if (body.sourceUrl !== null && body.sourceUrl !== undefined) {
    const parsed = parseSafeUrl(body.sourceUrl);
    if (parsed === null) {
      throw new ApiError('link_invalid');
    }
    sourceUrl = parsed.url;
  }
  return deps.db.transaction(async (tx) => {
    await liveOffice(tx, officeId);
    if (isFirstDay(viewer.createdAt, now)) {
      throw new ApiError('account_too_new');
    }
    // index: field_reports_user
    const [counted] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${fieldReports.id}::text)`,
      })
      .from(fieldReports)
      .where(
        and(
          eq(fieldReports.userId, viewer.userId),
          gt(fieldReports.id, uuidFloor(new Date(now.getTime() - WINDOW_MS))),
        ),
      );
    if (
      counted !== undefined &&
      counted.n >= LIMITS.fieldReportsPerDay &&
      counted.oldest !== null
    ) {
      const waitMs = uuidTimeMs(counted.oldest) + WINDOW_MS - now.getTime();
      throw new ApiError('daily_limit_reached', {
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / SECOND_MS)),
      });
    }
    const id = newId();
    await tx.insert(fieldReports).values({
      id,
      userId: viewer.userId,
      officeId,
      field: body.field ?? null,
      message: body.message ?? null,
      sourceUrl,
      createdAt: now,
    });
    return { id };
  });
}
