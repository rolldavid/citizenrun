import { users } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { eq, sql } from 'drizzle-orm';

/**
 * E-ME-14: forgets the user's districts in one transaction: every `user_districts` row goes, and
 * `location_precision` and `districts_stale_at` become null. Onboarding is unchanged; a repeat
 * changes nothing more.
 */
export async function clearLocation(db: Db, input: { userId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    // index: user_districts_pkey
    await tx.execute(sql`delete from user_districts where user_id = ${input.userId}`);
    await tx
      .update(users)
      .set({ locationPrecision: null, districtsStaleAt: null })
      .where(eq(users.id, input.userId));
  });
}
