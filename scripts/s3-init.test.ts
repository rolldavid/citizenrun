import {
  CreateBucketCommand,
  GetBucketCorsCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import type { CORSRule } from '@aws-sdk/client-s3';
import { createS3Client } from '@citizenrun/shared/storage';
import { describe, expect, it, vi } from 'vitest';
import { mediaCorsRules } from './lib/cors.ts';
import { initBuckets, main, parseInitArgs, UsageError } from './s3-init.ts';
import type { InitOptions } from './s3-init.ts';

type FakeStore = {
  client: ReturnType<typeof createS3Client>;
  sent: string[];
  created: string[];
  corsPut: Map<string, CORSRule[]>;
};

class NotFoundFixture extends Error {
  override name = 'NotFound';
}

/** A real client whose `send` answers from memory: HeadBucket, CreateBucket and the two CORS calls. */
function fakeStore(
  existing: readonly string[],
  options?: { corsReadBack?: CORSRule[] },
): FakeStore {
  const client = createS3Client({
    endpoint: 'http://localhost:8333',
    region: 'us-east-1',
    accessKeyId: 'fixture-access-key',
    secretAccessKey: 'fixture-secret-key',
    forcePathStyle: true,
  });
  const buckets = new Set(existing);
  const store: FakeStore = { client, sent: [], created: [], corsPut: new Map() };
  // The client's overloads include a callback form; the stub answers the promise form only.
  const sender = client as unknown as { send: (command: unknown) => Promise<unknown> };
  vi.spyOn(sender, 'send').mockImplementation((command: unknown) => {
    if (command instanceof HeadBucketCommand) {
      const bucket = command.input.Bucket ?? '';
      store.sent.push(`head ${bucket}`);
      return buckets.has(bucket) ? Promise.resolve({}) : Promise.reject(new NotFoundFixture());
    }
    if (command instanceof CreateBucketCommand) {
      const bucket = command.input.Bucket ?? '';
      store.sent.push(`create ${bucket}`);
      buckets.add(bucket);
      store.created.push(bucket);
      return Promise.resolve({});
    }
    if (command instanceof PutBucketCorsCommand) {
      const bucket = command.input.Bucket ?? '';
      store.sent.push(`put-cors ${bucket}`);
      store.corsPut.set(bucket, command.input.CORSConfiguration?.CORSRules ?? []);
      return Promise.resolve({});
    }
    if (command instanceof GetBucketCorsCommand) {
      const bucket = command.input.Bucket ?? '';
      store.sent.push(`get-cors ${bucket}`);
      return Promise.resolve({
        CORSRules: options?.corsReadBack ?? store.corsPut.get(bucket) ?? [],
      });
    }
    return Promise.reject(new Error('unexpected command'));
  });
  return store;
}

function options(overrides: Partial<InitOptions>): InitOptions {
  return {
    endpoint: 'http://localhost:8333',
    region: 'us-east-1',
    buckets: ['media'],
    corsOrigins: null,
    forcePathStyle: true,
    accessKeyId: 'fixture-access-key',
    secretAccessKey: 'fixture-secret-key',
    ...overrides,
  };
}

const KEYS = { S3_ACCESS_KEY_ID: 'fixture-access-key', S3_SECRET_ACCESS_KEY: 'fixture-secret-key' };

describe('initBuckets', () => {
  it('creates each missing bucket in order', async () => {
    const store = fakeStore(['data']);
    await initBuckets(store.client, options({ buckets: ['media', 'data', 'backups'] }));
    expect(store.created).toEqual(['media', 'backups']);
    expect(store.sent).toEqual([
      'head media',
      'create media',
      'head data',
      'head backups',
      'create backups',
    ]);
  });

  it('applies media CORS to the named buckets only when origins are given', async () => {
    const without = fakeStore([]);
    await initBuckets(without.client, options({ buckets: ['media', 'data'] }));
    expect(without.corsPut.size).toBe(0);

    const origins = ['https://staging.example.test', 'http://localhost:8081'];
    const withOrigins = fakeStore([]);
    await initBuckets(
      withOrigins.client,
      options({ buckets: ['media', 'data'], corsOrigins: origins }),
    );
    expect([...withOrigins.corsPut.keys()]).toEqual(['media', 'data']);
    for (const rules of withOrigins.corsPut.values()) {
      expect(rules).toEqual(mediaCorsRules(origins).CORSRules);
    }
    expect(withOrigins.sent.filter((line) => line.startsWith('get-cors'))).toEqual([
      'get-cors media',
      'get-cors data',
    ]);
  });

  it('a CORS read-back that differs fails', async () => {
    const store = fakeStore(['media'], {
      corsReadBack: mediaCorsRules(['https://other.example.test']).CORSRules,
    });
    await expect(
      initBuckets(store.client, options({ corsOrigins: ['https://staging.example.test'] })),
    ).rejects.toThrow(/differ/);
  });

  it('a CORS read-back in another order is the same rule', async () => {
    const [rule] = mediaCorsRules(['https://a.example.test', 'https://b.example.test']).CORSRules;
    expect(rule).toBeDefined();
    const reordered =
      rule === undefined
        ? []
        : [
            {
              ...rule,
              AllowedOrigins: [...rule.AllowedOrigins].reverse(),
              AllowedMethods: [...rule.AllowedMethods].reverse(),
            },
          ];
    const store = fakeStore(['media'], { corsReadBack: reordered });
    await expect(
      initBuckets(
        store.client,
        options({ corsOrigins: ['https://a.example.test', 'https://b.example.test'] }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('parseInitArgs', () => {
  const argv = ['--endpoint', 'http://localhost:8333', '--region', 'us-east-1', '--bucket', 'a,b'];

  it('reads the flags and the two keys', () => {
    expect(
      parseInitArgs([...argv, '--cors-origins', 'http://localhost:8081', '--path-style'], KEYS),
    ).toEqual({
      endpoint: 'http://localhost:8333',
      region: 'us-east-1',
      buckets: ['a', 'b'],
      corsOrigins: ['http://localhost:8081'],
      forcePathStyle: true,
      accessKeyId: 'fixture-access-key',
      secretAccessKey: 'fixture-secret-key',
    });
    expect(parseInitArgs(argv, KEYS).corsOrigins).toBeNull();
    expect(parseInitArgs(argv, KEYS).forcePathStyle).toBe(false);
  });

  it('keys come from the environment, never from arguments', () => {
    expect(() => parseInitArgs(argv, { S3_SECRET_ACCESS_KEY: 'fixture-secret-key' })).toThrow(
      /S3_ACCESS_KEY_ID/,
    );
    expect(() => parseInitArgs(argv, { S3_ACCESS_KEY_ID: 'fixture-access-key' })).toThrow(
      /S3_SECRET_ACCESS_KEY/,
    );
    expect(() => parseInitArgs([...argv, '--access-key-id', 'fixture-access-key'], KEYS)).toThrow(
      UsageError,
    );
  });

  it('an unknown flag is a usage error', () => {
    expect(() => parseInitArgs([...argv, '--force'], KEYS)).toThrow(UsageError);
    expect(() => parseInitArgs([...argv, '--force'], KEYS)).toThrow(/--force/);
  });

  it('a missing flag is a usage error naming it', () => {
    expect(() => parseInitArgs(['--endpoint', 'http://localhost:8333'], KEYS)).toThrow(/--region/);
    expect(() => parseInitArgs(argv.slice(0, 4), KEYS)).toThrow(/--bucket/);
  });

  it('main exits 2 with one usage line on a usage error', async () => {
    const lines: string[] = [];
    expect(await main(['--bogus'], KEYS, (line) => lines.push(line))).toBe(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^usage: /);
  });
});
