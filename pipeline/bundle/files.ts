// Step 10 of the bundle writer: byte-identical files. The same rows give the same bytes.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';

/** The gzip header's operating-system byte, fixed because zlib writes another value on macOS than on Linux. */
const GZIP_OS_BYTE = 0x03;

/** A row that fails its bundle schema: a defect of the writer. Names the file and the key only. */
export class BundleRowInvalid extends Error {
  override readonly name = 'BundleRowInvalid';
  readonly file: string;
  readonly key: string;

  constructor(file: string, key: string) {
    super(`a ${file} row fails its schema: ${key}`);
    this.file = file;
    this.key = key;
  }
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** `value` rebuilt with object keys in its schema's declaration order and record keys in byte order. */
function ordered(schema: z.ZodType, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    return ordered(schema.unwrap() as z.ZodType, value);
  }
  if (schema instanceof z.ZodDefault) {
    return ordered(schema.unwrap() as z.ZodType, value);
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodType>;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(shape)) {
      if (source[key] !== undefined) {
        out[key] = ordered(inner, source[key]);
      }
    }
    return out;
  }
  if (schema instanceof z.ZodArray) {
    return (value as unknown[]).map((item) => ordered(schema.element as z.ZodType, item));
  }
  if (schema instanceof z.ZodTuple) {
    const items = schema.def.items as readonly z.ZodType[];
    return (value as unknown[]).map((item, i) => {
      const inner = items[i];
      return inner === undefined ? item : ordered(inner, item);
    });
  }
  if (schema instanceof z.ZodRecord) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort(byteOrder)) {
      out[key] = ordered(schema.valueType as z.ZodType, source[key]);
    }
    return out;
  }
  return value;
}

/** Gzip at level 9 with MTIME 0, no file name and the fixed operating-system byte. */
export function gzipFixed(text: string): Uint8Array {
  const bytes = gzipSync(text, { level: 9 });
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08 || bytes[3] !== 0x00) {
    throw new Error('gzip output does not start with a plain header');
  }
  bytes.fill(0, 4, 8);
  bytes[9] = GZIP_OS_BYTE;
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Validates every row with its B- schema, sorts by `source_key` in byte order, writes each row on
 * one line with keys in the schema's order, and gzips at level 9 with a fixed header.
 */
export function encodeFile<T>(
  rows: readonly T[],
  schema: z.ZodType<T>,
  file = 'bundle',
): { bytes: Uint8Array; sha256: string; rows: number } {
  const parsed = rows.map((row) => {
    const result = schema.safeParse(row);
    if (!result.success) {
      const key = (row as { source_key?: unknown }).source_key;
      throw new BundleRowInvalid(file, typeof key === 'string' ? key : '(no key)');
    }
    return result.data as T & { source_key: string };
  });
  parsed.sort((a, b) => byteOrder(a.source_key, b.source_key));
  let text = '';
  for (const row of parsed) {
    text += `${JSON.stringify(ordered(schema, row))}\n`;
  }
  const bytes = gzipFixed(text);
  return { bytes, sha256: sha256Hex(bytes), rows: parsed.length };
}
