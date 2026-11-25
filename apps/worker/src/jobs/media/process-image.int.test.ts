import { getTestBucket, getTestObject, resetStorage } from '@citizenrun/db/testing';
import { avatarUserPrefix } from '@citizenrun/shared/storage';
import { FakeClock } from '@citizenrun/shared/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { solidJpeg } from '../../lib/media/images.fixtures.ts';
import { listAllObjects } from '../../lib/storage.ts';
import { peekQueue, runJob } from '../../testing/job.ts';
import {
  avatarUpload,
  setAvatarColumns,
  uploadRow,
  userRow,
} from '../../lib/media/testing/avatar-upload.ts';
import { mediaProcessImage } from './process-image.ts';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

async function storedAvatars(userId: string): Promise<{ key: string; lastModified: number }[]> {
  const media = await getTestBucket('media');
  const found: { key: string; lastModified: number }[] = [];
  for await (const item of listAllObjects(media, avatarUserPrefix(userId))) {
    found.push({ key: item.key, lastModified: item.lastModified.getTime() });
  }
  return found;
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-media.process', () => {
  it('routes an avatar payload', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(800, 600));

    const result = await runJob(mediaProcessImage, fixture.payload, { clock });

    expect(result.outcome).toBe('completed');
    expect((await storedAvatars(fixture.user.id)).map((item) => item.key)).toEqual(
      [fixture.keys.large, fixture.keys.small].sort(),
    );
    expect((await userRow(fixture.user.id)).avatarKey).toBe(fixture.keys.small);
  });

  it('is idempotent', async () => {
    const clock = new FakeClock();
    const previous = await avatarUpload(clock, await solidJpeg(600, 600), {
      createdAt: new Date(clock.now().getTime() - 2 * HOUR_MS),
    });
    const fixture = await avatarUpload(clock, await solidJpeg(800, 600), { user: previous.user });
    await setAvatarColumns(fixture.user.id, { avatarKey: previous.keys.small });

    const first = await runJob(mediaProcessImage, fixture.payload, { clock });
    expect(first.outcome).toBe('completed');
    const written = (await storedAvatars(fixture.user.id)).filter((item) =>
      item.key.includes(fixture.upload.id),
    );
    const deletedAt = (await uploadRow(fixture.upload.id)).objectDeletedAt?.getTime();
    expect(deletedAt).toBe(clock.now().getTime());

    clock.advance(MINUTE_MS);
    const second = await runJob(mediaProcessImage, fixture.payload, { clock });

    expect(second.outcome).toBe('completed');
    expect(written).toHaveLength(2);
    expect(
      (await storedAvatars(fixture.user.id)).filter((item) => item.key.includes(fixture.upload.id)),
    ).toEqual(written);
    expect((await peekQueue('uploads.cleanup')).map((job) => job.data)).toEqual([
      { scope: 'avatar', userId: fixture.user.id, uploadId: previous.upload.id },
    ]);
    expect(await getTestObject('media', fixture.upload.key)).toBeNull();
    expect((await uploadRow(fixture.upload.id)).objectDeletedAt?.getTime()).toBe(deletedAt);
    expect((await userRow(fixture.user.id)).avatarKey).toBe(fixture.keys.small);
  });
});
