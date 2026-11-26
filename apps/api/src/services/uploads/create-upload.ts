import type { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { uploads, users } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import {
  ApiError,
  AVATAR_UPLOADS_PER_DAY,
  PHOTO_MAX_BYTES,
  UPLOAD_POLICY_TTL_S,
  VIDEO_MAX_BYTES_PHONE,
  VIDEO_MAX_BYTES_WEB,
  newId,
  uuidFloor,
} from '@citizenrun/shared';
import type { CreateUploadBody, UploadTicket } from '@citizenrun/shared';
import { incomingUploadKey } from '@citizenrun/shared/storage';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Platform } from '../../middleware/session.ts';

// The daily avatar limit counts the rows of the last 24 hours (D-240).
const DAY_MS = 24 * 60 * 60 * 1000;
const SECOND_MS = 1000;

// The size limit of L-upload-policy for the kind and the request's platform.
function maxBytesFor(kind: CreateUploadBody['kind'], platform: Platform): number {
  if (kind === 'photo') {
    return PHOTO_MAX_BYTES;
  }
  return platform === 'web' ? VIDEO_MAX_BYTES_WEB : VIDEO_MAX_BYTES_PHONE;
}

/**
 * E-UPL-01: an `uploads` row and a presigned POST policy bound to one key, one content type, the
 * byte range 1 to the limit and UPLOAD_POLICY_TTL_S seconds (D-248, CTL-05). A size over the limit
 * answers 422 `upload_too_large`; the twenty-first avatar ticket in 24 hours answers 429
 * `daily_limit_reached`, counted with the user's row locked so tickets asked for at once are counted
 * one after another. Nothing is logged here: never the URL, the fields or the key.
 */
export async function createUpload(
  db: Db,
  input: { userId: string; body: CreateUploadBody; platform: Platform; now: Date },
  media: { client: S3Client; bucket: string },
): Promise<UploadTicket> {
  const { userId, body, platform, now } = input;
  const maxBytes = maxBytesFor(body.kind, platform);
  if (body.size > maxBytes) {
    throw new ApiError('upload_too_large', { fields: { size: 'out_of_range' } });
  }

  const id = newId();
  const key = incomingUploadKey(userId, id, body.contentType);
  // One transaction, committed before signing: a policy that then fails to sign leaves an unconsumed
  // row, removed after 24 hours (D-142).
  await db.transaction(async (tx) => {
    // index: users_pkey
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('no key update');
    // index: uploads_user
    const [counted] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${uploads.createdAt})`.mapWith(uploads.createdAt),
      })
      .from(uploads)
      .where(
        and(
          eq(uploads.userId, userId),
          eq(uploads.purpose, 'avatar'),
          gte(uploads.id, uuidFloor(new Date(now.getTime() - DAY_MS))),
        ),
      );
    if (counted !== undefined && counted.n >= AVATAR_UPLOADS_PER_DAY) {
      const oldestMs = counted.oldest === null ? now.getTime() : counted.oldest.getTime();
      const waitMs = oldestMs + DAY_MS - now.getTime();
      throw new ApiError('daily_limit_reached', {
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / SECOND_MS)),
      });
    }
    await tx.insert(uploads).values({
      id,
      userId,
      key,
      kind: body.kind,
      purpose: body.purpose,
      platform,
      contentType: body.contentType,
      maxBytes,
      declaredBytes: body.size,
    });
  });

  // The library adds the exact key condition itself; signing is local (D-248).
  const { url, fields } = await createPresignedPost(media.client, {
    Bucket: media.bucket,
    Key: key,
    Conditions: [
      ['eq', '$Content-Type', body.contentType],
      ['content-length-range', 1, maxBytes],
    ],
    Fields: { 'Content-Type': body.contentType },
    Expires: UPLOAD_POLICY_TTL_S,
  });

  return {
    uploadId: id,
    key,
    method: 'POST',
    url,
    fields,
    headers: {},
    maxBytes,
    expiresAt: new Date(now.getTime() + UPLOAD_POLICY_TTL_S * SECOND_MS).toISOString(),
  };
}
