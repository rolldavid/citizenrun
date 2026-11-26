import type { Db, UserRow } from '@citizenrun/db';
import { insertUser } from '@citizenrun/db/testing';
import { insertSession } from './factories.ts';
import type { TestAuth } from './request.ts';

// The fixture admin address of the test environment's ADMIN_EMAILS.
const FIXTURE_ADMIN_EMAIL = 'admin@example.test';

/**
 * Creates a sessions row for `user` (platform `ios` for bearer, `web` for cookie) and returns the
 * raw token as bearer or cookie auth. Only the token's SHA-256 is stored; no sign-in route runs.
 */
export async function signIn(
  db: Db,
  user: { id: string },
  kind: 'bearer' | 'cookie',
  options: { authenticatedAt?: Date; expiresAt?: Date } = {},
): Promise<TestAuth> {
  const { token } = await insertSession(db, {
    userId: user.id,
    platform: kind === 'bearer' ? 'ios' : 'web',
    ...(options.authenticatedAt === undefined ? {} : { authenticatedAt: options.authenticatedAt }),
    ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
  });
  return { kind, token };
}

/**
 * Inserts the admin user (role `admin`, `admin@example.test` with its verified email identity) and
 * signs it in, freshly unless `authenticatedAt` is given. One call per test: the address is unique.
 */
export async function signInAdmin(
  db: Db,
  kind: 'bearer' | 'cookie',
  options: { authenticatedAt?: Date } = {},
): Promise<{ user: UserRow; auth: TestAuth }> {
  // insertUser writes the verified `email` identity for the address in the same transaction.
  const user = await insertUser(db, { role: 'admin', email: FIXTURE_ADMIN_EMAIL });
  const auth = await signIn(db, user, kind, options);
  return { user, auth };
}
