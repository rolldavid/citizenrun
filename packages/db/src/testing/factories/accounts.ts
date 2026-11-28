import { LEGAL_VERSIONS, newId } from '@citizenrun/shared';
import { exportKey } from '@citizenrun/shared/storage';
import { marker } from '@citizenrun/shared/testing';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../../client.ts';
import {
  authIdentities,
  dataExports,
  userConsents,
  userIssues,
  users,
} from '../../schema/accounts.ts';
import type {
  DataExportRow,
  NewDataExportRow,
  NewUserConsentRow,
  NewUserRow,
  UserConsentRow,
  UserIssueRow,
  UserRow,
} from '../../schema/accounts.ts';
import { issues } from '../../schema/reference.ts';
import { idAt } from '../ids.ts';
import { nextSequence } from '../sequence.ts';
import { DAY_MS, HOUR_MS, SECOND_MS, defaultFactoryContext, shiftMs } from './context.ts';
import type { FactoryContext } from './context.ts';

/** The overrides of the User factory: any column, and `newAccount` for an account one day old. */
export type UserOverrides = Partial<NewUserRow> & { newAccount?: boolean };

/**
 * A complete, finished `users` row: handle `test_<seq>`, an `@example.test` email holding the run
 * marker, an age record with no store signal, onboarding done 50 seconds after sign-up, created 30
 * days (or, with `newAccount`, 1 day) before `ctx.now`.
 */
export function makeUser(
  overrides: UserOverrides = {},
  ctx: FactoryContext = defaultFactoryContext(),
): NewUserRow {
  const { newAccount = false, ...columns } = overrides;
  const seq = nextSequence();
  const createdAt = columns.createdAt ?? shiftMs(ctx.now, -(newAccount ? 1 : 30) * DAY_MS);
  return {
    id: columns.createdAt === undefined ? newId() : idAt(columns.createdAt),
    handle: `test_${String(seq)}`,
    name: `Test User ${String(seq)}`,
    email: `test_${String(seq)}.${marker()}@example.test`,
    status: 'active',
    role: 'user',
    ageMethod: 'none',
    ageResult: null,
    ageSourceTier: null,
    ageCheckedAt: createdAt,
    onboardingStep: 'done',
    onboardedAt: shiftMs(createdAt, 50 * SECOND_MS),
    ...columns,
    createdAt,
  };
}

/**
 * Writes makeUser(overrides) and, in the same transaction, its verified `email` identity (subject
 * the lower-case email); with `email: null` no identity is written. Returns the stored user.
 */
export async function insertUser(
  db: Db,
  overrides: UserOverrides = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<UserRow> {
  const values = makeUser(overrides, ctx);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(users).values(values).returning();
    if (row === undefined) {
      throw new Error('The users insert returned no row.');
    }
    if (row.email !== null) {
      await tx.insert(authIdentities).values({
        userId: row.id,
        provider: 'email',
        subject: row.email.toLowerCase(),
        email: row.email,
        emailVerified: true,
        createdAt: row.createdAt,
      });
    }
    return row;
  });
}

/** A consent kind: a key of LEGAL_VERSIONS. */
export type ConsentKindKey = keyof typeof LEGAL_VERSIONS;

const CONSENT_KINDS: readonly ConsentKindKey[] = ['terms', 'content_policy', 'privacy_policy'];

/** The overrides of the Consent factory; `userId` is required. */
export type ConsentOverrides = Partial<NewUserConsentRow> & { userId: string };

/** A granted `terms` consent from iOS at its current LEGAL_VERSIONS value, unless overridden. */
export function makeConsent(overrides: ConsentOverrides): NewUserConsentRow {
  const kind = overrides.kind ?? 'terms';
  const version = overrides.version ?? (isConsentKind(kind) ? LEGAL_VERSIONS[kind] : undefined);
  if (version === undefined) {
    throw new RangeError('A consent of an unknown kind needs an explicit version.');
  }
  return {
    id: overrides.createdAt === undefined ? newId() : idAt(overrides.createdAt),
    granted: true,
    platform: 'ios',
    ...overrides,
    kind,
    version,
  };
}

function isConsentKind(kind: string): kind is ConsentKindKey {
  return Object.hasOwn(LEGAL_VERSIONS, kind);
}

/** Writes makeConsent(overrides) and returns the stored row. */
export async function insertConsent(db: Db, overrides: ConsentOverrides): Promise<UserConsentRow> {
  const [row] = await db.insert(userConsents).values(makeConsent(overrides)).returning();
  if (row === undefined) {
    throw new Error('The user_consents insert returned no row.');
  }
  return row;
}

/**
 * Writes the three consents of sign-up (`terms`, `content_policy`, `privacy_policy`), each
 * granted at its LEGAL_VERSIONS value unless `versions` gives another.
 */
export async function insertConsents(
  db: Db,
  userId: string,
  versions: Partial<Record<ConsentKindKey, string>> = {},
): Promise<UserConsentRow[]> {
  const rows: UserConsentRow[] = [];
  for (const kind of CONSENT_KINDS) {
    rows.push(
      await insertConsent(db, { userId, kind, version: versions[kind] ?? LEGAL_VERSIONS[kind] }),
    );
  }
  return rows;
}

/** One issue pick of setUserIssues. */
export type IssuePick = { issueId: string; starred?: boolean };

/**
 * Replaces the user's issue picks with `picks` in one transaction; by default the first three
 * issues by `sort`, none starred. Returns the stored rows.
 */
export async function setUserIssues(
  db: Db,
  userId: string,
  picks?: readonly IssuePick[],
): Promise<UserIssueRow[]> {
  return db.transaction(async (tx) => {
    const chosen: readonly IssuePick[] =
      picks ??
      (await tx.select({ issueId: issues.id }).from(issues).orderBy(asc(issues.sort)).limit(3));
    await tx.delete(userIssues).where(eq(userIssues.userId, userId));
    if (chosen.length === 0) {
      return [];
    }
    return tx
      .insert(userIssues)
      .values(
        chosen.map((pick) => ({
          userId,
          issueId: pick.issueId,
          starred: pick.starred ?? false,
        })),
      )
      .returning();
  });
}

/**
 * A `data_exports` row, `queued` unless the overrides give a status. A `ready` export gets the
 * key of L-object-keys, `ready_at` = `ctx.now` and `expires_at` 24 hours later, unless given.
 * Without a `userId` the row names a fresh id; insertDataExport then creates that user.
 */
export function makeDataExport(
  overrides: Partial<NewDataExportRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): NewDataExportRow {
  const id =
    overrides.id ?? (overrides.createdAt === undefined ? newId() : idAt(overrides.createdAt));
  const userId = overrides.userId ?? newId();
  const status = overrides.status ?? 'queued';
  if (status !== 'ready') {
    return { ...overrides, id, userId, status };
  }
  const readyAt = overrides.readyAt ?? ctx.now;
  return {
    objectKey: exportKey(userId, id),
    expiresAt: shiftMs(readyAt, 24 * HOUR_MS),
    ...overrides,
    id,
    userId,
    status,
    readyAt,
  };
}

/** Writes makeDataExport(overrides), creating its user when none is given; returns the stored row. */
export async function insertDataExport(
  db: Db,
  overrides: Partial<NewDataExportRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<DataExportRow> {
  const userId = overrides.userId ?? (await insertUser(db, {}, ctx)).id;
  const [row] = await db
    .insert(dataExports)
    .values(makeDataExport({ ...overrides, userId }, ctx))
    .returning();
  if (row === undefined) {
    throw new Error('The data_exports insert returned no row.');
  }
  return row;
}
