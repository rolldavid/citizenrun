import { issues, userIssues } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { ApiError } from '@citizenrun/shared';
import type { FieldCode, SetIssuesBody } from '@citizenrun/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Platform } from '../../middleware/session.ts';
import { advanceOnboarding } from './onboarding.ts';

/**
 * E-ME-09: replaces the user's issue picks with `issues` in one transaction and advances onboarding
 * from `issues`. An id that is not an issue answers `unknown_issue` with its index. Issue picks are
 * private: never logged, never in a job payload (INV-02).
 */
export async function setIssues(
  db: Db,
  input: { userId: string; issues: SetIssuesBody['issues']; now: Date; platform: Platform },
): Promise<void> {
  const ids = input.issues.map((pick) => pick.issueId);
  // index: issues_pkey
  const known = await db.select({ id: issues.id }).from(issues).where(inArray(issues.id, ids));
  const knownIds = new Set(known.map((row) => row.id));
  const fields: Record<string, FieldCode> = {};
  input.issues.forEach((pick, index) => {
    if (!knownIds.has(pick.issueId)) {
      fields[`issues.${String(index)}.issueId`] = 'invalid_value';
    }
  });
  if (Object.keys(fields).length > 0) {
    throw new ApiError('unknown_issue', { fields });
  }

  await db.transaction(async (tx) => {
    await tx.delete(userIssues).where(eq(userIssues.userId, input.userId));
    await tx.insert(userIssues).values(
      input.issues.map((pick) => ({
        userId: input.userId,
        issueId: pick.issueId,
        starred: pick.starred,
      })),
    );
    await advanceOnboarding(tx, {
      userId: input.userId,
      from: 'issues',
      outcome: 'completed',
      platform: input.platform,
      now: input.now,
    });
  });
}
