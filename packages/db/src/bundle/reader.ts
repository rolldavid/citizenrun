import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { BundleManifestSchema } from '@citizenrun/shared';
import type { BundleManifest } from '@citizenrun/shared';
import {
  BundleChecksumError,
  BundleManifestTooLargeError,
  BundleObjectMissingError,
  BundlePathError,
} from './errors.ts';
import { resolveRelative } from './paths.ts';

export { BundleObjectMissingError } from './errors.ts';

// The bundle readers of PIPE-loader: one for the `data` bucket and one for B-sample on disk. Every
// file is hashed and counted while it streams; nothing is trusted until the whole file is read.

/** The one bucket call the cores make. J-bundle.load adapts the worker's `data` bucket to it, so packages/db holds no worker code. */
export type DataBucketClient = {
  /** The object's bytes as a stream; rejects with BundleObjectMissingError when the key does not exist. */
  getStream(key: string): Promise<NodeJS.ReadableStream>;
};

export type BundleReader = {
  /** The manifest at `path`, validated with BundleManifestSchema (a failure throws the zod error). */
  readManifest(path: string): Promise<BundleManifest>;
  /** Decompressed non-empty lines of a gzip NDJSON file; throws BundleChecksumError when the sha256 or byte count differs, the gzip fails or the object is missing. */
  lines(path: string, expect: { sha256: string; bytes: number }): AsyncIterable<string>;
  /** The whole object; throws BundleChecksumError when its sha256 or byte count differs or it is missing. */
  bytes(path: string, expect: { sha256: string; bytes: number }): Promise<Uint8Array>;
};

export const MANIFEST_MAX_BYTES = 10_000_000; // PIPE-loader

/** Opens the object or file at a path relative to the root manifest's folder. */
type Opener = (path: string) => Promise<NodeJS.ReadableStream>;

const BUCKET_PREFIXES = ['bundles/', 'assets/'] as const;

/** Reads at most `limit` bytes of the stream; `over` is true when it held more. */
async function readAtMost(
  stream: NodeJS.ReadableStream,
  limit: number,
): Promise<{ bytes: Buffer; over: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      chunks.push(buffer);
      total += buffer.length;
      if (total > limit) {
        return { bytes: Buffer.concat(chunks).subarray(0, limit), over: true };
      }
    }
  } finally {
    destroy(stream);
  }
  return { bytes: Buffer.concat(chunks), over: false };
}

function destroy(stream: NodeJS.ReadableStream): void {
  if ('destroy' in stream && typeof stream.destroy === 'function') {
    (stream as Readable).destroy();
  }
}

async function openOrChecksum(openPath: Opener, path: string): Promise<NodeJS.ReadableStream> {
  try {
    return await openPath(path);
  } catch (error) {
    if (error instanceof BundleObjectMissingError) {
      throw new BundleChecksumError(path);
    }
    throw error;
  }
}

function matches(hex: string, count: number, expect: { sha256: string; bytes: number }): boolean {
  return hex === expect.sha256.toLowerCase() && count === expect.bytes;
}

function makeReader(openPath: Opener): BundleReader {
  return {
    async readManifest(path) {
      const { bytes, over } = await readAtMost(await openPath(path), MANIFEST_MAX_BYTES);
      if (over) {
        throw new BundleManifestTooLargeError(path);
      }
      const parsed: unknown = JSON.parse(bytes.toString('utf8'));
      return BundleManifestSchema.parse(parsed);
    },

    lines(path, expect) {
      return {
        async *[Symbol.asyncIterator]() {
          const source = await openOrChecksum(openPath, path);
          const hash = createHash('sha256');
          let count = 0;
          let sourceError: unknown = null;
          let zlibError: unknown = null;
          const meter = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              hash.update(chunk);
              count += chunk.length;
              done(null, chunk);
            },
          });
          const gunzip = createGunzip();
          const lineReader = createInterface({ input: gunzip, crlfDelay: Infinity });
          const stop = (): void => {
            lineReader.close();
          };
          source.on('error', (error: unknown) => {
            sourceError ??= error;
            gunzip.destroy();
            stop();
          });
          gunzip.on('error', (error: unknown) => {
            zlibError ??= error;
            stop();
          });
          source.pipe(meter).pipe(gunzip);
          try {
            try {
              for await (const line of lineReader) {
                if (line !== '') {
                  yield line;
                }
              }
            } catch (error) {
              // The line reader re-raises its input's error; the listeners above have recorded it.
              zlibError ??= sourceError === null ? error : null;
            }
            if (sourceError !== null) {
              throw sourceError instanceof Error
                ? sourceError
                : new Error('The bundle stream failed.');
            }
            if (zlibError !== null || !matches(hash.digest('hex'), count, expect)) {
              throw new BundleChecksumError(path);
            }
          } finally {
            lineReader.close();
            destroy(source);
            gunzip.destroy();
          }
        },
      };
    },

    async bytes(path, expect) {
      const { bytes, over } = await readAtMost(await openOrChecksum(openPath, path), expect.bytes);
      const hex = createHash('sha256').update(bytes).digest('hex');
      if (over || !matches(hex, bytes.length, expect)) {
        throw new BundleChecksumError(path);
      }
      return new Uint8Array(bytes);
    },
  };
}

/** A reader of the `data` bucket; every path is resolved against the folder of `manifestKey` and must stay under bundles/ or assets/. */
export function bucketReader(storage: DataBucketClient, manifestKey: string): BundleReader {
  return makeReader(async (path) => {
    const key = resolveRelative(manifestKey, path);
    if (!BUCKET_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      throw new BundlePathError(path);
    }
    return storage.getStream(key);
  });
}

/** A reader of B-sample on disk; every path is resolved against the folder of `manifestPath` and must stay inside the sample folder (its parent). */
export function diskReader(manifestPath: string): BundleReader {
  const folder = dirname(resolve(manifestPath));
  const root = dirname(folder);
  return makeReader(async (path) => {
    const file = resolve(folder, path);
    if (!file.startsWith(root + sep)) {
      throw new BundlePathError(path);
    }
    try {
      const handle = await open(file, 'r');
      return handle.createReadStream();
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new BundleObjectMissingError(path);
      }
      throw error;
    }
  });
}
