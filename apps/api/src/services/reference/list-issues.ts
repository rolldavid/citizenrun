import { issues } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import type { Issue } from '@citizenrun/shared';
import { asc } from 'drizzle-orm';

/** The 19 issues in sort order (E-REF-01); their colors are never sent. */
export async function listIssues(db: Db): Promise<Issue[]> {
  // No index: the 19-row reference table is read whole.
  return db
    .select({ id: issues.id, name: issues.name, icon: issues.icon, sort: issues.sort })
    .from(issues)
    .orderBy(asc(issues.sort));
}
