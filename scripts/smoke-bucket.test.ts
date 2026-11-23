import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { createS3Client } from '@citizenrun/shared/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  main,
  presignedGet,
  PRESIGNED_GET_SECONDS,
  runSmoke,
  signingDateFor,
  SMOKE_PREFIX,
} from './smoke-bucket.ts';
import type { SmokeResult } from './smoke-bucket.ts';

const ORIGIN = 'https://staging.example.test';

class NotFoundFixture extends Error {
  override name = 'NotFound';
}

function fixtureClient(): S3Client {
  return createS3Client({
    endpoint: 'http://localhost:8333',
    region: 'us-east-1',
    accessKeyId: 'fixture-access-key',
    secretAccessKey: 'fixture-secret-key',
    forcePathStyle: true,
  });
}

type StoreBehaviour = {
  /** Largest upload the fake store accepts; Infinity accepts any size. */
  maxBytes: number;
  /** Whether the store checks the Content-Type field against the policy. */
  checksType: boolean;
  /** Every request fails as a network error would. */
  offline: boolean;
  corsOrigin: string | null;
};

type Harness = {
  client: S3Client;
  fetch: typeof fetch;
  objects: Map<string, Uint8Array>;
  deleted: string[];
  requested: string[];
};

/**
 * A presigning client whose `send` answers HeadObject and DeleteObject from what the fake `fetch`
 * accepted, and a fake `fetch` that plays the store for the POST, the GET and the preflight.
 */
function harness(behaviour: Partial<StoreBehaviour> = {}): Harness {
  const rules: StoreBehaviour = {
    maxBytes: 2048,
    checksType: true,
    offline: false,
    corsOrigin: ORIGIN,
    ...behaviour,
  };
  const client = fixtureClient();
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const requested: string[] = [];
  // The client's overloads include a callback form; the stub answers the promise form only.
  const sender = client as unknown as { send: (command: unknown) => Promise<unknown> };
  vi.spyOn(sender, 'send').mockImplementation((command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      const body = objects.get(command.input.Key ?? '');
      return body === undefined
        ? Promise.reject(new NotFoundFixture())
        : Promise.resolve({ ContentLength: body.length });
    }
    if (command instanceof DeleteObjectCommand) {
      deleted.push(command.input.Key ?? '');
      objects.delete(command.input.Key ?? '');
      return Promise.resolve({});
    }
    return Promise.reject(new Error('unexpected command'));
  });
  const keyOf = (url: string): string | null => {
    const path = decodeURIComponent(new URL(url).pathname);
    return [...objects.keys()].find((key) => path.endsWith(`/${key}`)) ?? null;
  };
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    requested.push(method);
    if (rules.offline) {
      throw new TypeError('fetch failed');
    }
    if (method === 'POST') {
      const form = init?.body;
      if (!(form instanceof FormData)) {
        return new Response(null, { status: 400 });
      }
      const key = form.get('key');
      const file = form.get('file');
      const type = form.get('Content-Type');
      if (typeof key !== 'string' || !(file instanceof Blob)) {
        return new Response(null, { status: 400 });
      }
      if (file.size > rules.maxBytes) {
        return new Response(null, { status: 400 });
      }
      if (rules.checksType && type !== 'image/jpeg') {
        return new Response(null, { status: 403 });
      }
      objects.set(key, new Uint8Array(await file.arrayBuffer()));
      return new Response(null, { status: 204 });
    }
    if (method === 'OPTIONS') {
      const headers = new Headers();
      if (rules.corsOrigin !== null) {
        headers.set('Access-Control-Allow-Origin', rules.corsOrigin);
      }
      return new Response(null, { status: 200, headers });
    }
    const key = keyOf(url);
    const body = key === null ? undefined : objects.get(key);
    return body === undefined
      ? new Response(null, { status: 404 })
      : new Response(new Uint8Array(body), { status: 200 });
  };
  return { client, fetch: fakeFetch, objects, deleted, requested };
}

async function smoke(h: Harness): Promise<{ results: SmokeResult[]; keys: string[] }> {
  let clock = Date.parse('2027-03-05T10:00:00.000Z');
  const keys: string[] = [];
  const results = await runSmoke({
    client: h.client,
    bucket: 'media',
    origin: ORIGIN,
    fetch: h.fetch,
    now: () => new Date(clock),
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    newKey: () => {
      const key = `${SMOKE_PREFIX}fixture-${String(keys.length + 1)}.jpg`;
      keys.push(key);
      return key;
    },
  });
  return { results, keys };
}

describe('the signing date', () => {
  it('the signing date floors to 12 hours', () => {
    expect(signingDateFor(new Date('2027-03-05T11:59:59.999Z')).toISOString()).toBe(
      '2027-03-05T00:00:00.000Z',
    );
    expect(signingDateFor(new Date('2027-03-05T12:00:00.000Z')).toISOString()).toBe(
      '2027-03-05T12:00:00.000Z',
    );
    expect(PRESIGNED_GET_SECONDS).toBe(36 * 60 * 60);
  });

  it('two presigned GET URLs two seconds apart are identical', async () => {
    const client = fixtureClient();
    const first = await presignedGet(
      client,
      'media',
      'smoke/fixture.jpg',
      new Date('2027-03-05T10:00:00.000Z'),
    );
    const second = await presignedGet(
      client,
      'media',
      'smoke/fixture.jpg',
      new Date('2027-03-05T10:00:02.000Z'),
    );
    expect(second).toBe(first);
    expect(first).toContain('X-Amz-Expires=129600');
    expect(first).toContain('X-Amz-Date=20270305T000000Z');
  });

  it('URLs across a 12-hour boundary differ', async () => {
    const client = fixtureClient();
    const before = await presignedGet(
      client,
      'media',
      'smoke/fixture.jpg',
      new Date('2027-03-05T11:59:59.000Z'),
    );
    const after = await presignedGet(
      client,
      'media',
      'smoke/fixture.jpg',
      new Date('2027-03-05T12:00:01.000Z'),
    );
    expect(after).not.toBe(before);
  });
});

describe('runSmoke', () => {
  it('all five checks pass against a well-behaved store', async () => {
    const h = harness();
    const { results } = await smoke(h);
    expect(results.map((result) => [result.id, result.name, result.pass])).toEqual([
      [1, 'post-upload', true],
      [2, 'post-oversize', true],
      [3, 'post-wrong-type', true],
      [4, 'get-stable', true],
      [5, 'cors-preflight', true],
    ]);
    expect(h.requested).toEqual(['POST', 'POST', 'POST', 'GET', 'OPTIONS']);
  });

  it('an oversize upload that succeeds fails check 2', async () => {
    const { results } = await smoke(harness({ maxBytes: Number.POSITIVE_INFINITY }));
    const check2 = results.find((result) => result.id === 2);
    expect(check2?.pass).toBe(false);
    expect(check2?.detail).toBe('status 204, object present');
    expect(results.filter((result) => !result.pass).map((result) => result.id)).toEqual([2]);
  });

  it('a store that ignores the content type fails check 3', async () => {
    const { results } = await smoke(harness({ checksType: false }));
    expect(results.filter((result) => !result.pass).map((result) => result.id)).toEqual([3]);
  });

  it('a preflight without the origin fails check 5', async () => {
    const { results } = await smoke(harness({ corsOrigin: '*' }));
    expect(results.filter((result) => !result.pass).map((result) => result.id)).toEqual([5]);
  });

  it('results never contain a URL or a signature', async () => {
    for (const h of [
      harness(),
      harness({ maxBytes: Number.POSITIVE_INFINITY, checksType: false, corsOrigin: null }),
      harness({ offline: true }),
    ]) {
      const { results, keys } = await smoke(h);
      expect(results).toHaveLength(5);
      for (const result of results) {
        expect(result.detail).not.toContain('X-Amz-Signature');
        expect(result.detail).not.toContain('http');
        expect(result.detail).not.toContain('fixture-');
        for (const key of keys) {
          expect(result.detail).not.toContain(key);
        }
      }
    }
  });

  it('every written key is deleted, even after a failure', async () => {
    const offline = harness({ offline: true });
    const failed = await smoke(offline);
    expect(failed.results.every((result) => !result.pass)).toBe(true);
    expect(failed.keys).toHaveLength(3);
    expect([...offline.deleted].sort()).toEqual([...failed.keys].sort());

    const healthy = harness();
    const passed = await smoke(healthy);
    expect([...healthy.deleted].sort()).toEqual([...passed.keys].sort());
    expect(healthy.objects.size).toBe(0);
    expect(passed.keys.every((key) => key.startsWith(SMOKE_PREFIX))).toBe(true);
  });
});

describe('main', () => {
  it('a missing variable exits 2 naming it', async () => {
    const lines: string[] = [];
    const code = await main(
      {
        MEDIA_BUCKET: 'media',
        MEDIA_ENDPOINT: 'http://localhost:8333',
        MEDIA_REGION: 'us-east-1',
        MEDIA_ACCESS_KEY_ID: 'fixture-access-key',
        PUBLIC_URL: ORIGIN,
      },
      (line) => lines.push(line),
    );
    expect(code).toBe(2);
    expect(lines).toEqual(['smoke-bucket: missing or invalid MEDIA_SECRET_ACCESS_KEY']);
  });
});
