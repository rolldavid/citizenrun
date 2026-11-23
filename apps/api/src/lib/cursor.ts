import { ApiError } from '@citizenrun/shared';
import type { z } from 'zod';

// L-cursor: a longer cursor is refused before it is decoded.
const MAX_CURSOR_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** The opaque cursor of L-cursor: base64url, no padding, of the UTF-8 JSON of the parsed value. */
export function encodeCursor<S extends z.ZodType>(schema: S, value: z.infer<S>): string {
  const parsed: unknown = schema.parse(value);
  return Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url');
}

/** Reads a cursor made by `encodeCursor`; anything else throws ApiError `invalid_cursor`. */
export function decodeCursor<S extends z.ZodType>(schema: S, raw: string): z.infer<S> {
  if (raw.length > MAX_CURSOR_LENGTH || !BASE64URL.test(raw)) {
    throw new ApiError('invalid_cursor');
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ApiError('invalid_cursor');
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError('invalid_cursor');
  }
  return result.data;
}
