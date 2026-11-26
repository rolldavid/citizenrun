import type { Db, Tx } from '@citizenrun/db';
import {
  authIdentities,
  issues,
  sessions,
  uploads,
  userConsents,
  userIssues,
  users,
} from '@citizenrun/db';
import {
  HANDLE_CHANGE_DAYS,
  LEGAL_VERSIONS,
  MeSchema,
  NEW_ACCOUNT_DAYS,
  SENSITIVE_RECENT_SIGNIN_MS,
} from '@citizenrun/shared';
import { ApiError } from '@citizenrun/shared';
import type { ConsentState, Me } from '@citizenrun/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps.ts';
import { toAvatarMedia } from '../../lib/media.ts';
import { loadLocationState } from './location-state.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// users.location_precision, a checked text column.
const PrecisionSchema = z.enum(['exact', 'approx']);

// The three agreements, in the order `consents.needed` lists them.
const AGREEMENTS = ['terms', 'content_policy', 'privacy_policy'] as const;
type Agreement = (typeof AGREEMENTS)[number];

function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

function iso(at: Date | null): string | null {
  return at === null ? null : at.toISOString();
}

/** ConsentState of L-age-consent for one user, against LEGAL_VERSIONS. */
export async function loadConsentState(db: Db | Tx, userId: string): Promise<ConsentState> {
  // index: user_consents_user
  const agreed = await db
    .selectDistinctOn([userConsents.kind], {
      kind: userConsents.kind,
      version: userConsents.version,
    })
    .from(userConsents)
    .where(
      and(
        eq(userConsents.userId, userId),
        eq(userConsents.granted, true),
        inArray(userConsents.kind, [...AGREEMENTS]),
      ),
    )
    .orderBy(asc(userConsents.kind), desc(userConsents.id));
  // index: user_consents_user
  const [screening] = await db
    .select({ granted: userConsents.granted })
    .from(userConsents)
    .where(and(eq(userConsents.userId, userId), eq(userConsents.kind, 'ai_screening')))
    .orderBy(desc(userConsents.id))
    .limit(1);

  const agreedVersions = new Map<string, string>(agreed.map((row) => [row.kind, row.version]));
  const consentOf = (kind: Agreement) => ({
    agreedVersion: agreedVersions.get(kind) ?? null,
    currentVersion: LEGAL_VERSIONS[kind],
  });
  return {
    terms: consentOf('terms'),
    contentPolicy: consentOf('content_policy'),
    privacyPolicy: consentOf('privacy_policy'),
    aiScreening: screening === undefined ? 'not_asked' : screening.granted ? 'granted' : 'declined',
    needed: AGREEMENTS.filter((kind) => agreedVersions.get(kind) !== LEGAL_VERSIONS[kind]),
  };
}

/**
 * The signed-in user's `Me` (E-ME-01), read by the user's id and the session in use.
 * `Me` carries no admin key (D-801). Throws `unauthenticated` when the user row is gone or
 * `deleting`, or the session row is gone.
 */
export async function loadMe(
  deps: Deps,
  input: { userId: string; sessionId: string; now: Date },
): Promise<Me> {
  const { db } = deps;
  const { userId, sessionId, now } = input;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user === undefined || user.status === 'deleting') {
    throw new ApiError('unauthenticated');
  }
  const [session] = await db
    .select({
      platform: sessions.platform,
      authenticatedAt: sessions.authenticatedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (session === undefined) {
    throw new ApiError('unauthenticated');
  }
  // index: auth_identities_user
  const methods = await db
    .selectDistinct({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId))
    .orderBy(asc(authIdentities.provider));
  // index: user_issues_pkey
  const picks = await db
    .select({ issueId: userIssues.issueId, starred: userIssues.starred })
    .from(userIssues)
    .innerJoin(issues, eq(issues.id, userIssues.issueId))
    .where(eq(userIssues.userId, userId))
    .orderBy(asc(issues.sort));
  const consents = await loadConsentState(db, userId);
  let avatarPending = user.avatarPendingKey !== null;
  if (!avatarPending) {
    // index: uploads_user
    const [pending] = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(
        and(
          eq(uploads.userId, userId),
          eq(uploads.purpose, 'avatar'),
          isNotNull(uploads.consumedAt),
          isNull(uploads.bytes),
          isNull(uploads.objectDeletedAt),
        ),
      )
      .limit(1);
    avatarPending = pending !== undefined;
  }

  // E-ME-01 step 3, from the users row above.
  const location = await loadLocationState(db, {
    userId,
    locationPrecision:
      user.locationPrecision === null ? null : PrecisionSchema.parse(user.locationPrecision),
    districtsStaleAt: user.districtsStaleAt,
  });

  const handleChangeAvailableAt =
    user.handleChangedAt === null ? null : addMs(user.handleChangedAt, HANDLE_CHANGE_DAYS * DAY_MS);

  return MeSchema.parse({
    id: user.id,
    handle: user.handle,
    name: user.name,
    bio: user.bio,
    link: user.link,
    // Only avatar_key: a pending avatar is shown to nobody (INV-42).
    avatar: await toAvatarMedia(user.avatarKey, deps.storage.media, now),
    avatarPending,
    email: user.email,
    emailStatus: user.emailStatus,
    signInMethods: methods.map((row) => row.provider),
    role: user.role,
    status: user.status,
    suspension:
      user.status === 'suspended'
        ? { reason: user.suspendedReason, since: iso(user.suspendedAt) }
        : null,
    onboardingStep: user.onboardingStep,
    onboardedAt: iso(user.onboardedAt),
    createdAt: user.createdAt.toISOString(),
    newAccountUntil: addMs(user.createdAt, NEW_ACCOUNT_DAYS * DAY_MS).toISOString(),
    handleChangeAvailableAt:
      handleChangeAvailableAt !== null && handleChangeAvailableAt.getTime() > now.getTime()
        ? handleChangeAvailableAt.toISOString()
        : null,
    issues: picks,
    locale: user.locale,
    age:
      user.ageMethod === null
        ? null
        : {
            method: user.ageMethod,
            sourceTier: user.ageSourceTier,
            checkedAt: iso(user.ageCheckedAt),
          },
    consents,
    session: {
      platform: session.platform,
      authenticatedAt: session.authenticatedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      sensitiveActionsUntil: addMs(
        session.authenticatedAt,
        SENSITIVE_RECENT_SIGNIN_MS,
      ).toISOString(),
    },
    location,
  });
}
