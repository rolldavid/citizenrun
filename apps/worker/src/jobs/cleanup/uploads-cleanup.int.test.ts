import {
  captureLogs,
  getTestBucket,
  getTestObject,
  listTestKeys,
  putTestObject,
  resetStorage,
} from '@citizenrun/db/testing';
import { avatarUploadPrefix } from '@citizenrun/shared/storage';
import { FakeClock } from '@citizenrun/shared/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { solidJpeg } from '../../lib/media/images.fixtures.ts';
import {
  avatarUpload,
  setAvatarColumns,
  uploadRow,
} from '../../lib/media/testing/avatar-upload.ts';
import type { AvatarFixture } from '../../lib/media/testing/avatar-upload.ts';
import { runJob } from '../../testing/job.ts';
import { uploadsCleanup } from './uploads-cleanup.ts';

// J-uploads.cleanup, scope `avatar`.

const HOUR_MS = 60 * 60 * 1000;

type Pair = { a: AvatarFixture; b: AvatarFixture };

// Two processed avatars of one user, A older than B, each with its two derivatives and its original.
async function twoAvatars(clock: FakeClock): Promise<Pair> {
  const a = await avatarUpload(clock, await solidJpeg(60, 60), {
    createdAt: new Date(clock.now().getTime() - 2 * HOUR_MS),
  });
  const b = await avatarUpload(clock, await solidJpeg(80, 60), { user: a.user });
  for (const fixture of [a, b]) {
    for (const key of [fixture.keys.large, fixture.keys.small]) {
      await putTestObject('media', key, await solidJpeg(40, 40), 'image/jpeg');
    }
  }
  return { a, b };
}

function payloadOf(fixture: AvatarFixture): {
  scope: 'avatar';
  userId: string;
  uploadId: string;
} {
  return { scope: 'avatar', userId: fixture.user.id, uploadId: fixture.upload.id };
}

async function keysOf(fixture: AvatarFixture): Promise<string[]> {
  return listTestKeys('media', avatarUploadPrefix(fixture.user.id, fixture.upload.id));
}

function events(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-uploads.cleanup', () => {
  it('deletes an old avatar’s objects and original', async () => {
    const clock = new FakeClock();
    const { a, b } = await twoAvatars(clock);
    await setAvatarColumns(a.user.id, { avatarKey: b.keys.small });

    const result = await runJob(uploadsCleanup, payloadOf(a), { clock });

    expect(result.outcome).toBe('completed');
    expect(await keysOf(a)).toEqual([]);
    expect(await getTestObject('media', a.upload.key)).toBeNull();
    expect((await uploadRow(a.upload.id)).objectDeletedAt?.getTime()).toBe(clock.now().getTime());
    expect(await keysOf(b)).toEqual([b.keys.large, b.keys.small].sort());
    expect(await getTestObject('media', b.upload.key)).not.toBeNull();
    expect((await uploadRow(b.upload.id)).objectDeletedAt).toBeNull();
    expect(events('uploads.cleanup.done')).toEqual([
      expect.objectContaining({ scope: 'avatar', objects: 3 }),
    ]);
  });

  it('a stale job for an avatar that is current again deletes nothing', async () => {
    const clock = new FakeClock();
    const { b } = await twoAvatars(clock);
    await setAvatarColumns(b.user.id, { avatarKey: b.keys.small });

    const result = await runJob(uploadsCleanup, payloadOf(b), { clock });

    expect(result.outcome).toBe('completed');
    expect(await keysOf(b)).toEqual([b.keys.large, b.keys.small].sort());
    expect(await getTestObject('media', b.upload.key)).not.toBeNull();
    expect((await uploadRow(b.upload.id)).objectDeletedAt).toBeNull();
    expect(events('uploads.cleanup.in_use')).toEqual([
      expect.objectContaining({ scope: 'avatar' }),
    ]);
    expect(events('uploads.cleanup.done')).toEqual([]);
  });

  it('keeps a pending avatar', async () => {
    const clock = new FakeClock();
    const { a, b } = await twoAvatars(clock);
    await setAvatarColumns(a.user.id, { avatarKey: a.keys.small, avatarPendingKey: b.keys.small });

    const result = await runJob(uploadsCleanup, payloadOf(b), { clock });

    expect(result.outcome).toBe('completed');
    expect(await keysOf(b)).toEqual([b.keys.large, b.keys.small].sort());
    expect(await getTestObject('media', b.upload.key)).not.toBeNull();
    expect((await uploadRow(b.upload.id)).objectDeletedAt).toBeNull();
  });

  it('is idempotent', async () => {
    const clock = new FakeClock();
    const { a, b } = await twoAvatars(clock);
    await setAvatarColumns(a.user.id, { avatarKey: b.keys.small });

    const first = await runJob(uploadsCleanup, payloadOf(a), { clock });
    const deletedAt = (await uploadRow(a.upload.id)).objectDeletedAt?.getTime();
    clock.advance(HOUR_MS);
    captureLogs().clear();
    const second = await runJob(uploadsCleanup, payloadOf(a), { clock });

    expect([first.outcome, second.outcome]).toEqual(['completed', 'completed']);
    expect(events('uploads.cleanup.done')).toEqual([
      expect.objectContaining({ scope: 'avatar', objects: 0 }),
    ]);
    expect(await keysOf(a)).toEqual([]);
    expect((await uploadRow(a.upload.id)).objectDeletedAt?.getTime()).toBe(deletedAt);
    expect(await keysOf(b)).toHaveLength(2);
  });

  it('touches nothing of another user’s upload', async () => {
    const clock = new FakeClock();
    const { a } = await twoAvatars(clock);
    const payload = { ...payloadOf(a), userId: '0195d2c4-7a10-7c3e-9a51-2f4c8b6d1e07' };

    const result = await runJob(uploadsCleanup, payload, { clock });

    expect(result.outcome).toBe('completed');
    // That user's prefix is empty and the upload is not theirs.
    expect(await keysOf(a)).toHaveLength(2);
    expect((await uploadRow(a.upload.id)).objectDeletedAt).toBeNull();
  });

  it('retries a bucket outage', async () => {
    const clock = new FakeClock();
    const { a, b } = await twoAvatars(clock);
    await setAvatarColumns(a.user.id, { avatarKey: b.keys.small });
    const media = await getTestBucket('media');

    const result = await runJob(uploadsCleanup, payloadOf(a), {
      clock,
      media: { client: media.client, bucket: `${media.bucket}_gone` },
    });

    expect(result.outcome).toBe('failed');
    expect(await keysOf(a)).toHaveLength(2);
    expect((await uploadRow(a.upload.id)).objectDeletedAt).toBeNull();
  });
});
