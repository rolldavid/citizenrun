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
import type { Me } from '@citizenrun/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { toAvatarMedia } from '../../lib/media.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// The three agreements, in the order `consents.needed` lists them.
const AGREEMENTS = ['terms', 'content_policy', 'privacy_policy'] as const;
type Agreement = (typeof AGREEMENTS)[number];

function addMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

function iso(at: Date | null): string | null {
  return at === null ? null : at.toISOString();
}

/**
 * The signed-in user's `Me` (E-ME-01 steps 2 and 6), read by the user's id
 * and the session in use. `Me` carries no admin key (D-801). Throws when the user or the session
 * row is missing.
 */
export async function loadMe(
  deps: Deps,
  input: { userId: string; sessionId: string; now: Date },
): Promise<Me> {
  const { db } = deps;
  const { userId, sessionId, now } = input;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (user === undefined) {
    throw new Error('The signed-in user has no row.');
  }
  // index: auth_identities_user
  const methods = await db
    .selectDistinct({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId))
    .orderBy(asc(authIdentities.provider));
  const picks = await db
    .select({ issueId: userIssues.issueId, starred: userIssues.starred })
    .from(userIssues)
    .innerJoin(issues, eq(issues.id, userIssues.issueId))
    .where(eq(userIssues.userId, userId))
    .orderBy(asc(issues.sort));
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
  const [session] = await db
    .select({
      platform: sessions.platform,
      authenticatedAt: sessions.authenticatedAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  if (session === undefined) {
    throw new Error('The session in use has no row.');
  }
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

  const agreedVersions = new Map<string, string>(agreed.map((row) => [row.kind, row.version]));
  const consentOf = (kind: Agreement) => ({
    agreedVersion: agreedVersions.get(kind) ?? null,
    currentVersion: LEGAL_VERSIONS[kind],
  });
  const needed = AGREEMENTS.filter((kind) => agreedVersions.get(kind) !== LEGAL_VERSIONS[kind]);
  const handleChangeAvailableAt =
    user.handleChangedAt === null ? null : addMs(user.handleChangedAt, HANDLE_CHANGE_DAYS * DAY_MS);

  return MeSchema.parse({
    id: user.id,
    handle: user.handle,
    name: user.name,
    bio: user.bio,
    link: user.link,
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
    consents: {
      terms: consentOf('terms'),
      contentPolicy: consentOf('content_policy'),
      privacyPolicy: consentOf('privacy_policy'),
      aiScreening:
        screening === undefined ? 'not_asked' : screening.granted ? 'granted' : 'declined',
      needed,
    },
    session: {
      platform: session.platform,
      authenticatedAt: session.authenticatedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      sensitiveActionsUntil: addMs(
        session.authenticatedAt,
        SENSITIVE_RECENT_SIGNIN_MS,
      ).toISOString(),
    },
  });
}
