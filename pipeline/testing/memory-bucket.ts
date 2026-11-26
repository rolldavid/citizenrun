import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { BucketDeleteError, dryRunCounter, withCommonMethods } from '../lib/bucket.ts';
import type { DataBucket, ObjectInfo } from '../lib/bucket.ts';

type Stored = { bytes: Uint8Array; contentType: string; lastModified: Date };

export type MemoryBucket = DataBucket & {
  /** Every stored key, in byte order. */
  keys(): readonly string[];
  /** Sets an object's LastModified, which housekeeping reads. */
  setLastModified(key: string, at: Date): void;
};

async function collect(body: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/**
 * An in-memory DataBucket for unit tests: content types, sizes, a LastModified the test can set
 * and the index-file rule, with the same dry-run counting as the store.
 */
export function createMemoryBucket(
  opts: { name?: string; dryRun?: boolean; log?: Logger; now?: () => Date } = {},
): MemoryBucket {
  const objects = new Map<string, Stored>();
  const counter = dryRunCounter();
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? (() => new Date());
  const log =
    opts.log ?? createLogger({ service: 'pipeline', level: 'error', sink: () => undefined });

  const put = (key: string, bytes: Uint8Array, contentType: string) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (dryRun) {
      counter.add(key, bytes.byteLength);
    } else {
      objects.set(key, { bytes, contentType, lastModified: now() });
    }
    return { sha256, bytes: bytes.byteLength };
  };

  const bucket = withCommonMethods(
    {
      name: opts.name ?? 'memory',
      dryRun,
      getStream(key) {
        const found = objects.get(key);
        return Promise.resolve(
          found === undefined
            ? null
            : {
                body: Readable.from([Buffer.from(found.bytes)]),
                contentType: found.contentType,
                size: found.bytes.byteLength,
              },
        );
      },
      putBytes(key, body, contentType) {
        return Promise.resolve(put(key, new Uint8Array(body), contentType));
      },
      async putStream(key, body, contentType) {
        return put(key, await collect(body), contentType);
      },
      head(key) {
        const found = objects.get(key);
        return Promise.resolve(
          found === undefined
            ? null
            : {
                key,
                size: found.bytes.byteLength,
                lastModified: found.lastModified,
                contentType: found.contentType,
              },
        );
      },
      async *list(prefix): AsyncIterable<ObjectInfo> {
        const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort(byteOrder);
        for (const key of keys) {
          const found = objects.get(key);
          if (found !== undefined) {
            await Promise.resolve();
            yield { key, size: found.bytes.byteLength, lastModified: found.lastModified };
          }
        }
      },
      delete(keys) {
        if (keys.some((key) => key === '')) {
          return Promise.reject(new BucketDeleteError(1));
        }
        if (!dryRun) {
          for (const key of keys) {
            objects.delete(key);
          }
        }
        return Promise.resolve();
      },
      dryRunCounts() {
        return counter.counts;
      },
    },
    log,
  );

  return Object.assign(bucket, {
    keys: () => [...objects.keys()].sort(byteOrder),
    setLastModified(key: string, at: Date) {
      const found = objects.get(key);
      if (found === undefined) {
        throw new Error('setLastModified: no such object');
      }
      found.lastModified = at;
    },
  });
}
