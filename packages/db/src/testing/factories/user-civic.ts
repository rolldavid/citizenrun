import { newId } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { eq } from 'drizzle-orm';
import type { Db } from '../../client.ts';
import { userDistricts } from '../../schema/accounts.ts';
import type { UserDistrictRow } from '../../schema/accounts.ts';
import { adminActions } from '../../schema/moderation.ts';
import type { AdminActionRow, NewAdminActionRow } from '../../schema/moderation.ts';
import { bookmarks, fieldReports, follows } from '../../schema/social.ts';
import type {
  BookmarkRow,
  FieldReportRow,
  FollowRow,
  NewBookmarkRow,
  NewFieldReportRow,
  NewFollowRow,
} from '../../schema/social.ts';
import { idAt } from '../ids.ts';
import { nextSequence } from '../sequence.ts';
import { insertUser } from './accounts.ts';
import { insertOffice } from './civic.ts';
import { defaultFactoryContext } from './context.ts';
import type { FactoryContext } from './context.ts';
import { insertDistrict } from './geo.ts';

// The factories of the tables through which a user touches civic data, and of the audit log
// (TEST-harness-factories). A user's districts are ids only: no point or address is
// ever stored.

/** A user-data row's id: `idAt(createdAt)` when the time is given, otherwise a new id. */
function userRowId(id: string | undefined, createdAt: Date | undefined): string {
  return id ?? (createdAt === undefined ? newId() : idAt(createdAt));
}

/**
 * Replaces the user's `user_districts` rows with one per id, in one transaction; without ids, one
 * exact district made on demand. Returns the stored rows.
 */
export async function setUserDistricts(
  db: Db,
  userId: string,
  districtIds?: readonly string[],
): Promise<UserDistrictRow[]> {
  const ids = districtIds ?? [(await insertDistrict(db)).id];
  return db.transaction(async (tx) => {
    await tx.delete(userDistricts).where(eq(userDistricts.userId, userId));
    if (ids.length === 0) {
      return [];
    }
    return tx
      .insert(userDistricts)
      .values(ids.map((districtId) => ({ userId, districtId })))
      .returning();
  });
}

/**
 * A follow of an office. Without a `followerId` or a `targetId` the row names new ids;
 * insertFollow then creates an active user and an office.
 */
export function makeFollow(overrides: Partial<NewFollowRow> = {}): NewFollowRow {
  return {
    followerId: newId(),
    targetType: 'office',
    targetId: newId(),
    ...overrides,
  };
}

/** Writes makeFollow, creating its follower and its office when not given; returns the row. */
export async function insertFollow(
  db: Db,
  overrides: Partial<NewFollowRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<FollowRow> {
  const followerId = overrides.followerId ?? (await insertUser(db, {}, ctx)).id;
  const targetId = overrides.targetId ?? (await insertOffice(db)).id;
  const [row] = await db
    .insert(follows)
    .values(makeFollow({ ...overrides, followerId, targetId }))
    .returning();
  if (row === undefined) {
    throw new Error('The follows insert returned no row.');
  }
  return row;
}

/**
 * An office a user saved. Without a `userId` or an `officeId` the row names new ids;
 * insertBookmark then creates a user and an office.
 */
export function makeBookmark(overrides: Partial<NewBookmarkRow> = {}): NewBookmarkRow {
  return { userId: newId(), officeId: newId(), ...overrides };
}

/** Writes makeBookmark, creating its user and its office when not given; returns the row. */
export async function insertBookmark(
  db: Db,
  overrides: Partial<NewBookmarkRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<BookmarkRow> {
  const userId = overrides.userId ?? (await insertUser(db, {}, ctx)).id;
  const officeId = overrides.officeId ?? (await insertOffice(db)).id;
  const [row] = await db
    .insert(bookmarks)
    .values(makeBookmark({ ...overrides, userId, officeId }))
    .returning();
  if (row === undefined) {
    throw new Error('The bookmarks insert returned no row.');
  }
  return row;
}

/**
 * An open report about a whole office (`field` null) with the note `Fixture note <marker>` and no
 * link; the export and decision columns null. Without a `userId` or an `officeId` the row names
 * new ids; insertFieldReport then creates a user and an office.
 */
export function makeFieldReport(overrides: Partial<NewFieldReportRow> = {}): NewFieldReportRow {
  return {
    userId: newId(),
    officeId: newId(),
    field: null,
    message: `Fixture note ${marker()}`,
    sourceUrl: null,
    status: 'open',
    exportedAt: null,
    decidedBy: null,
    decidedAt: null,
    ...overrides,
    id: userRowId(overrides.id, overrides.createdAt),
  };
}

/** Writes makeFieldReport, creating its user and its office when not given; returns the row. */
export async function insertFieldReport(
  db: Db,
  overrides: Partial<NewFieldReportRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<FieldReportRow> {
  const userId =
    overrides.userId === undefined ? (await insertUser(db, {}, ctx)).id : overrides.userId;
  const officeId = overrides.officeId ?? (await insertOffice(db)).id;
  const [row] = await db
    .insert(fieldReports)
    .values(makeFieldReport({ ...overrides, userId, officeId }))
    .returning();
  if (row === undefined) {
    throw new Error('The field_reports insert returned no row.');
  }
  return row;
}

/**
 * An audit-log row `fixture.action` with the target `{ type: 'fixture', id: '<seq>' }`. Without
 * an `adminId` the row names a new id; insertAdminAction then creates a user with the admin role.
 */
export function makeAdminAction(overrides: Partial<NewAdminActionRow> = {}): NewAdminActionRow {
  const seq = nextSequence();
  return {
    adminId: newId(),
    action: 'fixture.action',
    target: { type: 'fixture', id: String(seq) },
    ...overrides,
    id: userRowId(overrides.id, overrides.createdAt),
  };
}

/** Writes makeAdminAction, creating an admin when none is given; returns the stored row. */
export async function insertAdminAction(
  db: Db,
  overrides: Partial<NewAdminActionRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<AdminActionRow> {
  const adminId = overrides.adminId ?? (await insertUser(db, { role: 'admin' }, ctx)).id;
  const [row] = await db
    .insert(adminActions)
    .values(makeAdminAction({ ...overrides, adminId }))
    .returning();
  if (row === undefined) {
    throw new Error('The admin_actions insert returned no row.');
  }
  return row;
}
