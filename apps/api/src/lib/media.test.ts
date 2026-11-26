import { createS3Client } from '@citizenrun/shared/storage';
import { describe, expect, it } from 'vitest';
import { toAvatarMedia } from './media.ts';

// A client for the local store with fixture credentials: presigning signs in memory and makes no
// network call.
const media = {
  client: createS3Client({
    endpoint: 'http://localhost:8333',
    region: 'us-east-1',
    accessKeyId: 'fixture-access-key',
    secretAccessKey: 'fixture-secret-key',
    forcePathStyle: true,
  }),
  bucket: 'fixture-media',
};

const NOW = new Date('2027-03-05T22:00:00.000Z');
const KEY =
  'avatars/0195d2c4-0000-7000-8000-000000000001/0195d2c4-0000-7000-8000-000000000002/320.jpg';

describe('toAvatarMedia', () => {
  it('no avatar key gives null', async () => {
    expect(await toAvatarMedia(null, media, NOW)).toBeNull();
  });

  it('an avatar key gives a 320 square with no blurhash', async () => {
    const avatar = await toAvatarMedia(KEY, media, NOW);
    expect(avatar).toEqual({
      kind: 'image',
      key: KEY,
      url: expect.any(String),
      width: 320,
      height: 320,
      blurhash: null,
      thumb: null,
      poster: null,
      durationMs: null,
    });
    const url = new URL(avatar?.url ?? '');
    expect(url.pathname).toBe(`/fixture-media/${KEY}`);
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
    // Signed at the 12-hour floor with a 36-hour life (D-249).
    expect(url.searchParams.get('X-Amz-Date')).toBe('20270305T120000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('129600');
  });

  it('two calls in one 12-hour window give the same url', async () => {
    const first = await toAvatarMedia(KEY, media, NOW);
    const later = await toAvatarMedia(KEY, media, new Date('2027-03-05T23:59:00.000Z'));
    expect(later?.url).toBe(first?.url);
  });
});
