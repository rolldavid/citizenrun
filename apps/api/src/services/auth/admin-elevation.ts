import { users } from '@citizenrun/db';
import type { Tx } from '@citizenrun/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { AdminEmails } from '../../middleware/gates.ts';

/**
 * L-admin-elevation: a user whose email is in `adminEmails` and whose role is `user` becomes an
 * admin; true when a row changed. Never demotes and checks no provider. An empty
 * set makes no query. The caller logs `auth.admin_bootstrap` after its transaction commits.
 */
export async function applyAdminElevation(
  tx: Tx,
  input: { userId: string; adminEmails: AdminEmails },
): Promise<boolean> {
  if (input.adminEmails.size === 0) {
    return false;
  }
  const promoted = await tx
    .update(users)
    .set({ role: 'admin' })
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.role, 'user'),
        isNotNull(users.email),
        sql`lower(${users.email}::text) = any(${sql.param([...input.adminEmails])}::text[])`,
      ),
    )
    .returning({ id: users.id });
  return promoted.length > 0;
}
