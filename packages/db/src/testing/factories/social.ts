import { PHOTO_MAX_BYTES, UPLOAD_EXTENSIONS, newId } from '@citizenrun/shared';
import type { UploadContentType } from '@citizenrun/shared';
import { incomingUploadKey } from '@citizenrun/shared/storage';
import type { Db } from '../../client.ts';
import { uploads } from '../../schema/social.ts';
import type { NewUploadRow, UploadRow } from '../../schema/social.ts';
import { idAt } from '../ids.ts';
import { insertUser } from './accounts.ts';
import { defaultFactoryContext } from './context.ts';
import type { FactoryContext } from './context.ts';

function isUploadContentType(value: string): value is UploadContentType {
  return Object.hasOwn(UPLOAD_EXTENSIONS, value);
}

/**
 * An unconsumed avatar photo upload from iOS: `image/jpeg`, 500,000 bytes declared under the
 * photo limit, keyed by L-object-keys unless the overrides give a `key`. Without a `userId` the
 * row names a fresh id; insertUpload then creates that user.
 */
export function makeUpload(overrides: Partial<NewUploadRow> = {}): NewUploadRow {
  const id =
    overrides.id ?? (overrides.createdAt === undefined ? newId() : idAt(overrides.createdAt));
  const userId = overrides.userId ?? newId();
  const contentType = overrides.contentType ?? 'image/jpeg';
  let key = overrides.key;
  if (key === undefined) {
    if (!isUploadContentType(contentType)) {
      throw new RangeError('An upload of an unknown content type needs an explicit key.');
    }
    key = incomingUploadKey(userId, id, contentType);
  }
  return {
    kind: 'photo',
    purpose: 'avatar',
    platform: 'ios',
    maxBytes: PHOTO_MAX_BYTES,
    declaredBytes: 500_000,
    consumedAt: null,
    objectDeletedAt: null,
    ...overrides,
    id,
    userId,
    contentType,
    key,
  };
}

/** Writes makeUpload(overrides), creating its user when none is given; returns the stored row. */
export async function insertUpload(
  db: Db,
  overrides: Partial<NewUploadRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<UploadRow> {
  const userId = overrides.userId ?? (await insertUser(db, {}, ctx)).id;
  const [row] = await db
    .insert(uploads)
    .values(makeUpload({ ...overrides, userId }))
    .returning();
  if (row === undefined) {
    throw new Error('The uploads insert returned no row.');
  }
  return row;
}
