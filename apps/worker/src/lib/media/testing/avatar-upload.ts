import { uploads, users } from '@citizenrun/db';
import type { UploadRow, UserRow } from '@citizenrun/db';
import { getTestDb, insertUpload, insertUser, putTestObject } from '@citizenrun/db/testing';
import type { UserOverrides } from '@citizenrun/db/testing';
import { avatarKeys } from '@citizenrun/shared/storage';
import type { FakeClock } from '@citizenrun/shared/testing';
import { eq } from 'drizzle-orm';

// Avatar uploads for the media and cleanup tests: a consumed `uploads` row with its original
// written under its `incoming/` key.

type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp';

export type AvatarFixture = {
  user: UserRow;
  upload: UploadRow;
  keys: { small: string; large: string };
  payload: { target: 'avatar'; userId: string; uploadId: string };
};

const CONSUMED_BEFORE_MS = 4_000;

/**
 * A consumed avatar upload of `user` (a new factory user by default) whose original holds `bytes`.
 * `declared` is the upload's content type (default image/jpeg), `stored` the object's (default the
 * declared one). `createdAt` orders two uploads of one user, since upload ids follow it.
 */
export async function avatarUpload(
  clock: FakeClock,
  bytes: Uint8Array,
  options: {
    user?: UserRow;
    userOverrides?: UserOverrides;
    declared?: PhotoType;
    stored?: string;
    maxBytes?: number;
    createdAt?: Date;
  } = {},
): Promise<AvatarFixture> {
  const db = getTestDb();
  const user = options.user ?? (await insertUser(db, options.userOverrides ?? {}));
  const declared = options.declared ?? 'image/jpeg';
  const upload = await insertUpload(db, {
    userId: user.id,
    contentType: declared,
    declaredBytes: bytes.byteLength,
    consumedAt: new Date(clock.now().getTime() - CONSUMED_BEFORE_MS),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  });
  await putTestObject('media', upload.key, bytes, options.stored ?? declared);
  return {
    user,
    upload,
    keys: avatarKeys(user.id, upload.id),
    payload: { target: 'avatar', userId: user.id, uploadId: upload.id },
  };
}

/** The user's row as stored now. */
export async function userRow(id: string): Promise<UserRow> {
  const [row] = await getTestDb().select().from(users).where(eq(users.id, id));
  if (row === undefined) {
    throw new Error('no such user');
  }
  return row;
}

/** The upload's row as stored now. */
export async function uploadRow(id: string): Promise<UploadRow> {
  const [row] = await getTestDb().select().from(uploads).where(eq(uploads.id, id));
  if (row === undefined) {
    throw new Error('no such upload');
  }
  return row;
}

/** Sets the user's avatar columns directly, as E-ME-02 and an earlier pass would have. */
export async function setAvatarColumns(
  userId: string,
  values: { avatarKey?: string | null; avatarPendingKey?: string | null },
): Promise<void> {
  await getTestDb().update(users).set(values).where(eq(users.id, userId));
}
