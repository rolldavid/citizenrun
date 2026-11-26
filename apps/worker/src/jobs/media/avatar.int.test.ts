import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { markAccountDeleting, users } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import {
  captureLogs,
  getTestBucket,
  getTestDb,
  getTestObject,
  listTestKeys,
  resetStorage,
} from '@citizenrun/db/testing';
import { avatarUserPrefix } from '@citizenrun/shared/storage';
import { FakeClock } from '@citizenrun/shared/testing';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLUE,
  RED,
  hasGpsIfd,
  heicHead,
  htmlBytes,
  near,
  pixelAt,
  rotatedJpegWithGps,
  solidJpeg,
  solidPng,
  truncated,
} from '../../lib/media/images.fixtures.ts';
import { sha256Of } from '../../lib/media/photo.ts';
import type { Bucket } from '../../lib/storage.ts';
import { peekQueue, runJob } from '../../testing/job.ts';
import {
  avatarUpload,
  setAvatarColumns,
  uploadRow,
  userRow,
} from '../../lib/media/testing/avatar-upload.ts';
import type { AvatarFixture } from '../../lib/media/testing/avatar-upload.ts';
import { mediaProcessImage } from './process-image.ts';

// TEST-media-avatar: J-media.process for avatars against the test database and media bucket.

const HOUR_MS = 60 * 60 * 1000;
// Large fixtures take a second or two to encode and decode.
const SLOW_MS = 30_000;

function events(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

async function derivatives(userId: string): Promise<string[]> {
  return listTestKeys('media', avatarUserPrefix(userId));
}

// The test media bucket under a name no bucket can have: the local store creates a bucket on its
// first write, so the underscore keeps every call failing.
async function missingBucket(): Promise<Bucket> {
  const media = await getTestBucket('media');
  return { client: media.client, bucket: `${media.bucket}_gone` };
}

async function expectRefused(
  fixture: AvatarFixture,
  clock: FakeClock,
  reason: string,
): Promise<void> {
  captureLogs().clear();
  const result = await runJob(mediaProcessImage, fixture.payload, { clock });
  expect(result.outcome).toBe('completed');
  expect(await derivatives(fixture.user.id)).toEqual([]);
  expect(await getTestObject('media', fixture.upload.key)).toBeNull();
  const upload = await uploadRow(fixture.upload.id);
  expect(upload.objectDeletedAt?.getTime()).toBe(clock.now().getTime());
  expect(upload.bytes).toBeNull();
  expect(upload.sha256).toBeNull();
  expect((await userRow(fixture.user.id)).avatarKey).toBeNull();
  expect(events('media.failed')).toEqual([
    expect.objectContaining({ level: 'warn', target: 'avatar', reason }),
  ]);
}

/** The test database, with every update of `users` failing: a write that fails once. */
function failingUserUpdates(): Db {
  const db = getTestDb();
  return new Proxy(db, {
    get(target, property, receiver): unknown {
      if (property === 'update') {
        return (table: Parameters<Db['update']>[0]) => {
          if (table === users) {
            throw new Error('fixture write failure');
          }
          return target.update(table);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-media.process for an avatar', () => {
  it(
    'strips metadata and rotates',
    async () => {
      const clock = new FakeClock();
      const input = await rotatedJpegWithGps(4000, 3000);
      expect((await sharp(input).metadata()).orientation).toBe(6);
      expect(hasGpsIfd(input)).toBe(true);
      const fixture = await avatarUpload(clock, input);

      const result = await runJob(mediaProcessImage, fixture.payload, { clock });

      expect(result.outcome).toBe('completed');
      expect(await derivatives(fixture.user.id)).toEqual(
        [fixture.keys.large, fixture.keys.small].sort(),
      );
      const large = await getTestObject('media', fixture.keys.large);
      const small = await getTestObject('media', fixture.keys.small);
      if (large === null || small === null) {
        throw new Error('a derivative is missing');
      }
      for (const [bytes, side] of [
        [large, 1080],
        [small, 320],
      ] as const) {
        const metadata = await sharp(bytes).metadata();
        expect([metadata.format, metadata.width, metadata.height]).toEqual(['jpeg', side, side]);
        expect(metadata.exif).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
      }
      expect(near(await pixelAt(large, 540, 100), RED)).toBe(true);
      expect(near(await pixelAt(large, 540, 980), BLUE)).toBe(true);
      const user = await userRow(fixture.user.id);
      expect(user.avatarKey).toBe(fixture.keys.small);
      expect(user.avatarPendingKey).toBeNull();
      expect(events('media.done')).toEqual([
        expect.objectContaining({ target: 'avatar', latencyMs: 4000 }),
      ]);
    },
    SLOW_MS,
  );

  it('writes immutable JPEG derivatives', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(1200, 900));

    await runJob(mediaProcessImage, fixture.payload, { clock });

    const media = await getTestBucket('media');
    for (const key of [fixture.keys.large, fixture.keys.small]) {
      const head = await media.client.send(
        new HeadObjectCommand({ Bucket: media.bucket, Key: key }),
      );
      expect(head.ContentType).toBe('image/jpeg');
      expect(head.CacheControl).toBe('public, max-age=31536000, immutable');
    }
  });

  it('refuses what it cannot decode', async () => {
    const clock = new FakeClock();
    const jpeg = await solidJpeg(1200, 900);
    await expectRefused(await avatarUpload(clock, truncated(jpeg)), clock, 'undecodable');
    await expectRefused(await avatarUpload(clock, heicHead()), clock, 'bad_type');
    await expectRefused(await avatarUpload(clock, htmlBytes()), clock, 'bad_type');
  });

  it(
    'refuses huge pixel counts',
    async () => {
      const clock = new FakeClock();
      const fixture = await avatarUpload(clock, await solidJpeg(8000, 7000));
      await expectRefused(fixture, clock, 'too_many_pixels');
    },
    SLOW_MS,
  );

  it('refuses a PNG declared as a JPEG', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidPng(600, 600), { declared: 'image/jpeg' });
    await expectRefused(fixture, clock, 'bad_type');
  });

  it('refuses an object stored with another type than the upload declared', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(600, 600), {
      stored: 'image/png',
    });
    await expectRefused(fixture, clock, 'bad_type');
  });

  it('refuses an object over its limit', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, new Uint8Array(2000).fill(0xff), {
      maxBytes: 1000,
    });
    await expectRefused(fixture, clock, 'too_large');
  });

  it('refuses an upload whose object is missing', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(600, 600));
    const media = await getTestBucket('media');
    await media.client.send(
      new DeleteObjectCommand({ Bucket: media.bucket, Key: fixture.upload.key }),
    );
    await expectRefused(fixture, clock, 'missing');
  });

  it('a refused avatar clears its own pending key and keeps the previous avatar', async () => {
    const clock = new FakeClock();
    const previous = await avatarUpload(clock, await solidJpeg(600, 600), {
      createdAt: new Date(clock.now().getTime() - 2 * HOUR_MS),
    });
    const fixture = await avatarUpload(clock, truncated(await solidJpeg(1200, 900)), {
      user: previous.user,
    });
    await setAvatarColumns(fixture.user.id, {
      avatarKey: previous.keys.small,
      avatarPendingKey: fixture.keys.small,
    });

    const result = await runJob(mediaProcessImage, fixture.payload, { clock });

    expect(result.outcome).toBe('completed');
    const user = await userRow(fixture.user.id);
    expect(user.avatarKey).toBe(previous.keys.small);
    expect(user.avatarPendingKey).toBeNull();
    expect(await peekQueue('uploads.cleanup')).toEqual([]);
  });

  it('a refused avatar whose pending key could not be cleared clears it on the retry', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, truncated(await solidJpeg(1200, 900)));
    await setAvatarColumns(fixture.user.id, { avatarPendingKey: fixture.keys.small });

    const first = await runJob(mediaProcessImage, fixture.payload, {
      clock,
      db: failingUserUpdates(),
      retryCount: 0,
    });
    expect(first.outcome).toBe('failed');

    const retry = await runJob(mediaProcessImage, fixture.payload, { clock, retryCount: 1 });

    expect(retry.outcome).toBe('completed');
    expect((await userRow(fixture.user.id)).avatarPendingKey).toBeNull();
    expect(await getTestObject('media', fixture.upload.key)).toBeNull();
    expect((await uploadRow(fixture.upload.id)).objectDeletedAt).not.toBeNull();
  });

  it('others see the default until it passes', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(1200, 900));
    await setAvatarColumns(fixture.user.id, { avatarPendingKey: fixture.keys.small });
    const before = await userRow(fixture.user.id);
    expect(before.avatarKey).toBeNull();
    expect(before.avatarPendingKey).toBe(fixture.keys.small);

    await runJob(mediaProcessImage, fixture.payload, { clock });

    const after = await userRow(fixture.user.id);
    expect(after.avatarKey).toBe(fixture.keys.small);
    expect(after.avatarPendingKey).toBeNull();
  });

  it('deletes the original', async () => {
    const clock = new FakeClock();
    const input = await solidJpeg(1200, 900);
    const fixture = await avatarUpload(clock, input);
    expect(fixture.upload.key.startsWith('incoming/')).toBe(true);

    await runJob(mediaProcessImage, fixture.payload, { clock });

    expect(await getTestObject('media', fixture.upload.key)).toBeNull();
    const upload = await uploadRow(fixture.upload.id);
    expect(upload.bytes).toBe(input.byteLength);
    expect(upload.sha256).toBe(sha256Of(input));
    expect(upload.objectDeletedAt?.getTime()).toBe(clock.now().getTime());
  });

  it('replaces the previous avatar and queues its cleanup', async () => {
    const clock = new FakeClock();
    const a = await avatarUpload(clock, await solidJpeg(600, 600), {
      createdAt: new Date(clock.now().getTime() - 2 * HOUR_MS),
    });
    const b = await avatarUpload(clock, await solidJpeg(900, 600), { user: a.user });
    await setAvatarColumns(a.user.id, { avatarKey: a.keys.small });

    const result = await runJob(mediaProcessImage, b.payload, { clock });

    expect(result.outcome).toBe('completed');
    expect((await userRow(a.user.id)).avatarKey).toBe(b.keys.small);
    const queued = await peekQueue('uploads.cleanup');
    expect(queued.map((job) => job.data)).toEqual([
      { scope: 'avatar', userId: a.user.id, uploadId: a.upload.id },
    ]);
  });

  it('discards a superseded upload', async () => {
    const clock = new FakeClock();
    const a = await avatarUpload(clock, await solidJpeg(600, 600), {
      createdAt: new Date(clock.now().getTime() - 2 * HOUR_MS),
    });
    const b = await avatarUpload(clock, await solidJpeg(900, 600), {
      user: a.user,
      createdAt: new Date(clock.now().getTime() - HOUR_MS),
    });
    await setAvatarColumns(a.user.id, { avatarPendingKey: b.keys.small });

    const result = await runJob(mediaProcessImage, a.payload, { clock });

    expect(result.outcome).toBe('completed');
    expect(await listTestKeys('media', 'avatars/')).toEqual([]);
    const user = await userRow(a.user.id);
    expect(user.avatarKey).toBeNull();
    expect(user.avatarPendingKey).toBe(b.keys.small);
    expect((await peekQueue('uploads.cleanup')).map((job) => job.data)).toEqual([
      { scope: 'avatar', userId: a.user.id, uploadId: a.upload.id },
    ]);
    expect(events('media.superseded')).toHaveLength(1);
    expect(await getTestObject('media', b.upload.key)).not.toBeNull();
  });

  it('a newer avatar that arrives while it is processed wins', async () => {
    const clock = new FakeClock();
    const a = await avatarUpload(clock, await solidJpeg(600, 600), {
      createdAt: new Date(clock.now().getTime() - 2 * HOUR_MS),
    });
    const media = await getTestBucket('media');
    let newer: AvatarFixture | null = null;
    // The first derivative write stands for the time sharp takes: a newer upload is attached then.
    const racing = {
      send: async (command: unknown, options?: unknown): Promise<unknown> => {
        if (command instanceof PutObjectCommand && newer === null) {
          newer = await avatarUpload(clock, await solidJpeg(900, 600), { user: a.user });
        }
        return (media.client.send as (c: unknown, o?: unknown) => Promise<unknown>)(
          command,
          options,
        );
      },
    } as unknown as S3Client;

    const result = await runJob(mediaProcessImage, a.payload, {
      clock,
      media: { client: racing, bucket: media.bucket },
    });

    expect(result.outcome).toBe('completed');
    expect(newer).not.toBeNull();
    expect((await userRow(a.user.id)).avatarKey).toBeNull();
    expect((await peekQueue('uploads.cleanup')).map((job) => job.data)).toEqual([
      { scope: 'avatar', userId: a.user.id, uploadId: a.upload.id },
    ]);
    // The cleanup job deletes the original with the derivatives.
    expect(await getTestObject('media', a.upload.key)).not.toBeNull();
    expect((await uploadRow(a.upload.id)).objectDeletedAt).toBeNull();
  });

  it('leaves an account being deleted alone', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(1200, 900));
    await setAvatarColumns(fixture.user.id, { avatarPendingKey: fixture.keys.small });
    await getTestDb().transaction((tx) => markAccountDeleting(tx, fixture.user.id));
    const userBefore = await userRow(fixture.user.id);
    const uploadBefore = await uploadRow(fixture.upload.id);

    const result = await runJob(mediaProcessImage, fixture.payload, { clock });

    expect(result.outcome).toBe('completed');
    expect(await derivatives(fixture.user.id)).toEqual([]);
    expect(await getTestObject('media', fixture.upload.key)).not.toBeNull();
    expect(await userRow(fixture.user.id)).toEqual(userBefore);
    expect(await uploadRow(fixture.upload.id)).toEqual(uploadBefore);
    expect(await peekQueue('uploads.cleanup')).toEqual([]);
  });

  it('skips an upload that is not this user’s avatar', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(600, 600));
    const other = await avatarUpload(clock, await solidJpeg(600, 600));

    const result = await runJob(
      mediaProcessImage,
      { target: 'avatar', userId: other.user.id, uploadId: fixture.upload.id },
      { clock },
    );

    expect(result.outcome).toBe('completed');
    expect(events('media.skipped')).toEqual([
      expect.objectContaining({ target: 'avatar', reason: 'not_found' }),
    ]);
    expect(await listTestKeys('media', 'avatars/')).toEqual([]);
    expect(await getTestObject('media', fixture.upload.key)).not.toBeNull();
  });

  it('retries a bucket outage', async () => {
    const clock = new FakeClock();
    const fixture = await avatarUpload(clock, await solidJpeg(1200, 900));
    await setAvatarColumns(fixture.user.id, { avatarPendingKey: fixture.keys.small });
    const userBefore = await userRow(fixture.user.id);
    const uploadBefore = await uploadRow(fixture.upload.id);
    const media = await missingBucket();

    const first = await runJob(mediaProcessImage, fixture.payload, {
      clock,
      media,
      retryCount: 0,
    });

    expect(first.outcome).toBe('failed');
    expect(await userRow(fixture.user.id)).toEqual(userBefore);
    expect(await uploadRow(fixture.upload.id)).toEqual(uploadBefore);
    expect(events('media.failed')).toEqual([]);

    const last = await runJob(mediaProcessImage, fixture.payload, {
      clock,
      media,
      retryCount: 2,
    });

    expect(last.outcome).toBe('failed');
    expect(events('media.failed')).toEqual([
      expect.objectContaining({ level: 'warn', target: 'avatar', reason: 'retries_exhausted' }),
    ]);
    const user = await userRow(fixture.user.id);
    expect(user.avatarKey).toBeNull();
    expect(user.avatarPendingKey).toBeNull();
    // The delete never went through, so the original is not marked deleted.
    expect((await uploadRow(fixture.upload.id)).objectDeletedAt).toBeNull();
  });
});
