import { createHash } from 'node:crypto';
import type { Hash } from 'node:crypto';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import type { Readable, TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip, createGzip, gzipSync } from 'node:zlib';
import type { z } from 'zod';

const GZIP_HEADER_BYTES = 10;
const GZIP_OPTIONS = { level: 9 } as const;

/** One NDJSON line: the row's JSON, keys in the row's insertion order, then `\n`. */
export function ndjsonLine(row: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(row)}\n`;
}

/**
 * Rebuilds `row` with its keys in `keyOrder`, the schema's key order. Throws when the row lacks a
 * key of the order or holds a key the order does not name.
 */
export function orderKeys<T extends Record<string, unknown>>(
  row: T,
  keyOrder: readonly (keyof T)[],
): T {
  const names = keyOrder.map(String);
  if (new Set(names).size !== names.length) {
    throw new Error('orderKeys: the key order names a key twice');
  }
  const wanted = new Set(names);
  for (const key of Object.keys(row)) {
    if (!wanted.has(key)) {
      throw new Error(`orderKeys: the row holds the key ${key}, which the order does not name`);
    }
  }
  const out: Record<string, unknown> = {};
  for (const key of names) {
    if (!Object.hasOwn(row, key)) {
      throw new Error(`orderKeys: the row lacks the key ${key}`);
    }
    out[key] = row[key];
  }
  return out as T;
}

/**
 * Sets the gzip header's MTIME (bytes 4 to 7) to 0 and its OS byte (9) to 0xff, after checking
 * that the header is a plain deflate member with no flags (bytes 0 to 3 are 1f 8b 08 00).
 */
function normaliseHeader(header: Buffer): void {
  if (header[0] !== 0x1f || header[1] !== 0x8b || header[2] !== 0x08 || header[3] !== 0x00) {
    throw new Error('gzip output does not start with a plain header');
  }
  header.fill(0, 4, 8);
  header[9] = 0xff;
}

class HeaderPatch extends Transform {
  readonly hash: Hash = createHash('sha256');
  bytes = 0;
  private pending: Buffer[] = [];
  private pendingLength = 0;
  private patched = false;
  private readonly onFlush: () => void;

  constructor(onFlush: () => void) {
    super();
    this.onFlush = onFlush;
  }

  private forward(chunk: Buffer): void {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    this.push(chunk);
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    try {
      if (this.patched) {
        this.forward(chunk);
      } else {
        this.pending.push(chunk);
        this.pendingLength += chunk.length;
        if (this.pendingLength >= GZIP_HEADER_BYTES) {
          const head = Buffer.concat(this.pending);
          this.pending = [];
          normaliseHeader(head);
          this.patched = true;
          this.forward(head);
        }
      }
      done();
    } catch (error) {
      done(error instanceof Error ? error : new Error('gzip header patch failed'));
    }
  }

  override _flush(done: TransformCallback): void {
    if (!this.patched) {
      done(new Error('gzip output ended before its header'));
      return;
    }
    this.onFlush();
    done();
  }
}

/**
 * A gzip NDJSON writer with a normalised header (level 9, MTIME 0, OS byte 0xff). The sha256 and
 * byte count are of the bytes after that patch.
 *
 * Node's zlib writes an OS byte that differs between macOS and Linux, and its deflate output may
 * differ between CPU architectures; so the same rows give the same bytes on one machine, and any
 * "did this change" decision anywhere in the pipeline compares the uncompressed NDJSON or the
 * rows, never gzip bytes.
 *
 * The caller consumes `readable` (for example by streaming it to the bucket) while it writes;
 * `end()` resolves once the last byte has passed through.
 */
export class NdjsonGzWriter {
  readonly readable: Readable;
  private readonly gzip = createGzip(GZIP_OPTIONS);
  private readonly patch: HeaderPatch;
  private readonly flushed: Promise<void>;
  private rows = 0;
  private ended = false;

  constructor() {
    let resolveFlushed: () => void = () => undefined;
    this.flushed = new Promise<void>((resolve) => {
      resolveFlushed = resolve;
    });
    this.patch = new HeaderPatch(() => {
      resolveFlushed();
    });
    this.gzip.on('error', (error) => {
      this.patch.destroy(error);
    });
    this.readable = this.gzip.pipe(this.patch);
  }

  /** Writes one row as one line. */
  write(row: Readonly<Record<string, unknown>>): void {
    if (this.ended) {
      throw new Error('NdjsonGzWriter: write after end');
    }
    this.gzip.write(ndjsonLine(row));
    this.rows += 1;
  }

  /** True when the gzip stream's buffer is full; await `drained()` before the next write. */
  get needsDrain(): boolean {
    return this.gzip.writableNeedDrain;
  }

  /** Resolves when the gzip stream can take more rows. */
  async drained(): Promise<void> {
    if (this.gzip.writableNeedDrain) {
      await once(this.gzip, 'drain');
    }
  }

  /** Ends the stream; resolves with the row count and the bytes and sha256 of the output. */
  async end(): Promise<{ rows: number; bytes: number; sha256: string }> {
    this.ended = true;
    this.gzip.end();
    await Promise.race([
      this.flushed,
      once(this.patch, 'error').then(([error]: unknown[]) => {
        throw error instanceof Error ? error : new Error('gzip stream failed');
      }),
    ]);
    return { rows: this.rows, bytes: this.patch.bytes, sha256: this.patch.hash.digest('hex') };
  }
}

/** The gzip NDJSON of `rows` in one buffer, for small files: the same bytes as the writer. */
export function encodeNdjsonGz(rows: Iterable<Readonly<Record<string, unknown>>>): Uint8Array {
  let text = '';
  for (const row of rows) {
    text += ndjsonLine(row);
  }
  const bytes = gzipSync(text, GZIP_OPTIONS);
  normaliseHeader(bytes);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A line of a gzip NDJSON file that is not JSON or fails its schema. Holds the line number only. */
export class NdjsonLineError extends Error {
  override readonly name = 'NdjsonLineError';
  readonly lineNumber: number;

  constructor(lineNumber: number) {
    super(`NDJSON line ${String(lineNumber)} is not a valid row`);
    this.lineNumber = lineNumber;
  }
}

function parseLine<T>(line: string, lineNumber: number, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new NdjsonLineError(lineNumber);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new NdjsonLineError(lineNumber);
  }
  return result.data;
}

/**
 * Reads a gzip NDJSON body row by row: gunzips it, splits on `\n` across chunk boundaries, skips
 * one trailing empty line and parses each line with `schema`.
 */
export async function* readNdjsonGz<T>(body: Readable, schema: z.ZodType<T>): AsyncIterable<T> {
  const gunzip = createGunzip();
  body.on('error', (error) => {
    gunzip.destroy(error);
  });
  body.pipe(gunzip);
  const decoder = new StringDecoder('utf8');
  let rest = '';
  let lineNumber = 0;
  for await (const chunk of gunzip as AsyncIterable<Buffer>) {
    rest += decoder.write(chunk);
    let start = 0;
    let newline = rest.indexOf('\n', start);
    while (newline !== -1) {
      lineNumber += 1;
      yield parseLine(rest.slice(start, newline), lineNumber, schema);
      start = newline + 1;
      newline = rest.indexOf('\n', start);
    }
    rest = rest.slice(start);
  }
  rest += decoder.end();
  if (rest !== '') {
    lineNumber += 1;
    yield parseLine(rest, lineNumber, schema);
  }
}
