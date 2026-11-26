import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import type { DataBucket } from '../bucket.ts';
import { extForContentType, storeRawBody } from './cache.ts';

describe('the raw cache', () => {
  it('content types to extensions', () => {
    const cases: [string | null, string][] = [
      ['text/html; charset=utf-8', 'html'],
      ['application/pdf', 'pdf'],
      ['text/csv', 'csv'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
      ['application/zip', 'zip'],
      ['application/x-zip-compressed', 'zip'],
      ['application/json', 'json'],
      ['application/xml', 'xml'],
      ['TEXT/XML', 'xml'],
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['text/plain;charset=us-ascii', 'txt'],
      ['application/octet-stream', 'bin'],
      [null, 'bin'],
    ];
    for (const [type, ext] of cases) {
      expect(extForContentType(type)).toBe(ext);
    }
  });

  it('a body already cached is not written again', async () => {
    const memory = createMemoryBucket();
    let writes = 0;
    const bucket: DataBucket = {
      ...memory,
      putBytes(key, body, contentType) {
        writes += 1;
        return memory.putBytes(key, body, contentType);
      },
    };
    const body = new TextEncoder().encode('<p>fixture</p>');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const first = await storeRawBody(bucket, body, 'text/html');
    expect(first).toEqual({ key: `cache/raw/${sha256}.html`, sha256, cached: false });
    const second = await storeRawBody(bucket, body, 'text/html');
    expect(second.cached).toBe(true);
    expect(writes).toBe(1);
    expect(memory.keys()).toEqual([`cache/raw/${sha256}.html`]);
  });
});
