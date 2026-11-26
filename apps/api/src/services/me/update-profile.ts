import { uploads, userConsents, users } from '@citizenrun/db';
import type { NewUserRow } from '@citizenrun/db';
import {
  ApiError,
  normalizeBio,
  normalizeProfileLink,
  normalizeProfileName,
} from '@citizenrun/shared';
import type { FieldCode, ProfileTextResult, UpdateMeBody } from '@citizenrun/shared';
import { uploadIdOfAvatarKey } from '@citizenrun/shared/storage';
import { and, eq, isNull } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';
import { enqueueOf } from '../../deps.ts';
import type { Platform } from '../../middleware/session.ts';
import { advanceOnboarding } from './onboarding.ts';

type TextKey = 'name' | 'bio' | 'link';

// The value to store for each text key present in the body; an absent key is left unchanged.
type NormalisedText = Partial<Record<TextKey, string | null>>;

const NORMALISERS: Readonly<Record<TextKey, (raw: string | null) => ProfileTextResult>> = {
  name: normalizeProfileName,
  bio: normalizeBio,
  link: normalizeProfileLink,
};

// L-profile-text over every text key present; every failing field is collected into one error.
function normaliseText(body: UpdateMeBody): NormalisedText {
  const values: NormalisedText = {};
  const fields: Record<string, FieldCode> = {};
  for (const key of ['name', 'bio', 'link'] as const) {
    const raw = body[key];
    if (raw === undefined) {
      continue;
    }
    const result = NORMALISERS[key](raw);
    if (result.ok) {
      values[key] = result.value;
    } else {
      fields[key] = result.error;
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError('invalid_request', { fields });
  }
  return values;
}

/**
 * E-ME-02: edits name, bio, link and locale; attaches an avatar upload (consumed and
 * sent to `media.process.image` in the same transaction, advancing onboarding from `photo`) or
 * removes the avatar (one `uploads.cleanup` per old key). Never writes `email` or `role`. Nothing
 * here is logged: no name, bio, link or upload key.
 */
export async function updateProfile(
  deps: Deps,
  input: { userId: string; body: UpdateMeBody; now: Date; platform: Platform },
): Promise<void> {
  const { db } = deps;
  const { userId, body, now, platform } = input;
  const text = normaliseText(body);

  // D-351: a changed, non-null bio needs an AI-screening answer, granted or declined.
  if (text.bio !== undefined && text.bio !== null) {
    const [stored] = await db.select({ bio: users.bio }).from(users).where(eq(users.id, userId));
    if (stored !== undefined && stored.bio !== text.bio) {
      // index: user_consents_user
      const [answer] = await db
        .select({ id: userConsents.id })
        .from(userConsents)
        .where(and(eq(userConsents.userId, userId), eq(userConsents.kind, 'ai_screening')))
        .limit(1);
      if (answer === undefined) {
        throw new ApiError('ai_consent_required');
      }
    }
  }

  let uploadId: string | null = null;
  if (typeof body.avatarUploadKey === 'string') {
    // index: uploads_key_key
    const [upload] = await db
      .select({ id: uploads.id })
      .from(uploads)
      .where(
        and(
          eq(uploads.key, body.avatarUploadKey),
          eq(uploads.userId, userId),
          eq(uploads.purpose, 'avatar'),
          isNull(uploads.consumedAt),
          isNull(uploads.objectDeletedAt),
        ),
      );
    if (upload === undefined) {
      throw new ApiError('upload_invalid');
    }
    uploadId = upload.id;
  }

  const enqueue = enqueueOf(deps);
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        avatarKey: users.avatarKey,
        avatarPendingKey: users.avatarPendingKey,
        bio: users.bio,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (current === undefined) {
      throw new ApiError('unauthenticated');
    }

    const changes: Partial<NewUserRow> = {};
    if (text.name !== undefined) {
      changes.name = text.name;
    }
    if (text.bio !== undefined) {
      changes.bio = text.bio;
      if (text.bio !== current.bio) {
        changes.bioAiScreenStatus = null;
      }
    }
    if (text.link !== undefined) {
      changes.link = text.link;
    }
    if (body.locale !== undefined) {
      changes.locale = body.locale;
    }
    if (body.avatarUploadKey === null) {
      changes.avatarKey = null;
      changes.avatarPendingKey = null;
    }
    if (Object.keys(changes).length > 0) {
      await tx.update(users).set(changes).where(eq(users.id, userId));
    }

    if (uploadId !== null) {
      const consumed = await tx
        .update(uploads)
        .set({ consumedAt: now })
        .where(and(eq(uploads.id, uploadId), isNull(uploads.consumedAt)))
        .returning({ id: uploads.id });
      if (consumed.length === 0) {
        // A concurrent request consumed it first; the throw rolls this transaction back.
        throw new ApiError('upload_invalid');
      }
      await enqueue('media.process.image', { target: 'avatar', userId, uploadId }, { tx });
      await advanceOnboarding(tx, { userId, from: 'photo', outcome: 'completed', platform, now });
    }

    if (body.avatarUploadKey === null) {
      for (const key of [current.avatarKey, current.avatarPendingKey]) {
        const oldUploadId = key === null ? null : uploadIdOfAvatarKey(key);
        if (oldUploadId !== null) {
          await enqueue(
            'uploads.cleanup',
            { scope: 'avatar', userId, uploadId: oldUploadId },
            { tx },
          );
        }
      }
    }
  });
}
