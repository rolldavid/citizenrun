import { jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { z } from 'zod';
import { authIdentities, markAccountDeleting, users } from '@citizenrun/db';
import { ApiError } from '@citizenrun/shared';
import { and, eq } from 'drizzle-orm';
import { enqueueOf } from '../../deps.ts';
import type { Deps } from '../../deps.ts';
import type { ApiEnv } from '../../env.ts';
import {
  APPLE_ISSUER,
  PROVIDER_CLOCK_TOLERANCE_S,
  PROVIDER_TOKEN_ALGORITHMS,
  appleConfig,
} from './apple.ts';
import { deleteAllSessions } from './sessions.ts';

// The `events` claim of a notice, as Apple sends it (D-242).
const AppleEventSchema = z.object({
  type: z.string().max(64),
  sub: z.string().max(255),
  email: z.string().optional(),
  is_private_email: z.union([z.boolean(), z.string()]).optional(),
  event_time: z.number().optional(),
});

type AppleEvent = z.infer<typeof AppleEventSchema>;

// The `events` claim is a JSON string or an object; anything else does not parse.
function parseEvent(claim: unknown): AppleEvent {
  let value: unknown = claim;
  if (typeof claim === 'string') {
    try {
      value = JSON.parse(claim);
    } catch {
      throw new ApiError('invalid_request');
    }
  }
  const parsed = AppleEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError('invalid_request');
  }
  return parsed.data;
}

/**
 * E-AUTH-07: acts on Apple's server-to-server notice once its JWS verifies against Apple's keys.
 * Repeating a notice leaves the same state. Never logs the payload, the subject or the email.
 */
export async function receiveAppleNotification(
  deps: Deps,
  env: ApiEnv,
  input: { payload: string; now: Date },
): Promise<void> {
  // Before anything else (PC3A-47).
  const config = appleConfig(env);
  if (config === null) {
    throw new ApiError('provider_not_configured');
  }
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(input.payload, deps.identityKeys.apple, {
      issuer: APPLE_ISSUER,
      audience: [config.bundleId, config.servicesId],
      algorithms: PROVIDER_TOKEN_ALGORITHMS,
      clockTolerance: PROVIDER_CLOCK_TOLERANCE_S,
      currentDate: input.now,
    }));
  } catch {
    throw new ApiError('signature_invalid');
  }
  const event = parseEvent(claims['events']);

  // index: auth_identities_pkey
  const [identity] = await deps.db
    .select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, 'apple'), eq(authIdentities.subject, event.sub)));
  if (identity === undefined) {
    return;
  }
  const { userId } = identity;

  switch (event.type) {
    case 'consent-revoked':
    case 'account-deleted': {
      const deleteAccount = event.type === 'account-deleted';
      await deps.db.transaction(async (tx) => {
        await deleteAllSessions(tx, userId);
        await tx
          .delete(authIdentities)
          .where(and(eq(authIdentities.provider, 'apple'), eq(authIdentities.subject, event.sub)));
        if (!deleteAccount) {
          return;
        }
        // index: auth_identities_user
        const [left] = await tx
          .select({ userId: authIdentities.userId })
          .from(authIdentities)
          .where(eq(authIdentities.userId, userId))
          .limit(1);
        if (left !== undefined) {
          return;
        }
        // No way in is left, so the account is deleted (CTL-15).
        await markAccountDeleting(tx, userId);
        await enqueueOf(deps)('account.delete', { userId, skipDeferral: false }, { tx });
      });
      return;
    }
    case 'email-disabled': {
      if (event.email === undefined) {
        return;
      }
      await deps.db
        .update(users)
        .set({ emailStatus: 'disabled' })
        .where(and(eq(users.id, userId), eq(users.email, event.email.toLowerCase())));
      return;
    }
    case 'email-enabled': {
      if (event.email === undefined) {
        return;
      }
      // PC3A-33.
      await deps.db
        .update(users)
        .set({ emailStatus: 'ok' })
        .where(
          and(
            eq(users.id, userId),
            eq(users.email, event.email.toLowerCase()),
            eq(users.emailStatus, 'disabled'),
          ),
        );
      return;
    }
    default:
      // Any other type changes nothing.
      return;
  }
}
