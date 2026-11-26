import { createS3Client } from '@citizenrun/shared/storage';
import { describe, expect, it } from 'vitest';
import { exportDownloadUrl } from './storage.ts';

// A client for the local store with fixture credentials: presigning signs in memory and makes no
// network call.
const client = createS3Client({
  endpoint: 'http://localhost:8333',
  region: 'us-east-1',
  accessKeyId: 'fixture-access-key',
  secretAccessKey: 'fixture-secret-key',
  forcePathStyle: true,
});
const BUCKET = 'fixture-media';
const KEY =
  'exports/0195d2c4-0000-7000-8000-000000000001/0195d2c4-0000-7000-8000-000000000002.json';

describe('exportDownloadUrl', () => {
  it('the export link expires in 300 seconds and names the file by its ready date', async () => {
    const readyAt = new Date('2027-03-05T23:30:00.000Z');
    const now = new Date('2027-03-06T08:15:00.000Z');
    const url = new URL(await exportDownloadUrl(client, BUCKET, KEY, readyAt, now));
    expect(url.pathname).toBe(`/${BUCKET}/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
    // Signed at `now`, not at the machine's clock.
    expect(url.searchParams.get('X-Amz-Date')).toBe('20270306T081500Z');
    // The UTC date of readyAt, even though `now` is a day later.
    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="export-2027-03-05.json"',
    );
    expect(url.searchParams.get('response-content-type')).toBe('application/json');
  });

  it('two calls a second apart give different links', async () => {
    const readyAt = new Date('2027-03-05T23:30:00.000Z');
    const first = await exportDownloadUrl(
      client,
      BUCKET,
      KEY,
      readyAt,
      new Date('2027-03-06T08:15:00.000Z'),
    );
    const second = await exportDownloadUrl(
      client,
      BUCKET,
      KEY,
      readyAt,
      new Date('2027-03-06T08:15:01.000Z'),
    );
    expect(second).not.toBe(first);
  });
});
