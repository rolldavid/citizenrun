import { describe, expect, it } from 'vitest';
import { createS3Client } from './client.ts';
import { MEDIA_URL_EXPIRES_S, MEDIA_URL_WINDOW_MS, mediaUrl } from './media-url.ts';

// Fixture credentials; signing makes no network call.
const client = createS3Client({
  endpoint: 'http://localhost:8333',
  region: 'us-east-1',
  accessKeyId: 'fixture-access-key',
  secretAccessKey: 'fixture-secret-key',
  forcePathStyle: true,
});
const BUCKET = 'media';
const KEY =
  'avatars/0195a7e0-0000-7000-8000-000000000001/0195a7e0-0000-7000-8000-000000000002/320.jpg';

function sign(at: string, key = KEY): Promise<string> {
  return mediaUrl(client, BUCKET, key, new Date(at));
}

describe('mediaUrl', () => {
  it('same key in one window gives the same URL', async () => {
    const early = await sign('2027-03-05T00:00:01.000Z');
    const late = await sign('2027-03-05T11:59:59.999Z');
    expect(late).toBe(early);
  });

  it('the next window gives a new URL', async () => {
    const before = await sign('2027-03-05T11:59:59.000Z');
    const after = await sign('2027-03-05T12:00:00.000Z');
    expect(after).not.toBe(before);
    expect(await sign('2027-03-05T23:59:59.000Z')).toBe(after);
  });

  it("the URL is signed at the window's start for 36 hours", async () => {
    const url = new URL(await sign('2027-03-05T17:45:12.000Z'));
    expect(url.searchParams.get('X-Amz-Date')).toBe('20270305T120000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('129600');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(MEDIA_URL_EXPIRES_S).toBe(36 * 60 * 60);
    expect(MEDIA_URL_WINDOW_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('no checksum mode in the URL', async () => {
    const url = new URL(await sign('2027-03-05T17:45:12.000Z'));
    const names = [...url.searchParams.keys()].map((name) => name.toLowerCase());
    expect(names).not.toContain('x-amz-checksum-mode');
    expect(names.filter((name) => name.includes('checksum'))).toEqual([]);
  });

  it('different keys give different URLs', async () => {
    const other = KEY.replace('320.jpg', '1080.jpg');
    const at = '2027-03-05T17:45:12.000Z';
    expect(await sign(at, other)).not.toBe(await sign(at));
  });
});
