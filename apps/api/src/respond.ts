import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiEnv } from './router.ts';

/** The Content-Type of every JSON response of the API (L-wire-format). */
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Thrown in strict mode when a handler hands `respond` keys its schema does not declare. */
export class ResponseShapeError extends Error {
  override readonly name = 'ResponseShapeError';
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    super(`Response holds undeclared fields: ${paths.join(', ')}`);
    this.paths = paths;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Key paths present in `input` and absent from `parsed`, through plain objects and arrays. The paths
// name keys only, never values, because a value may be private (INV-35).
function extraPaths(input: unknown, parsed: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    input.forEach((item: unknown, index) => {
      extraPaths(item, parsed[index], `${prefix}${String(index)}.`, out);
    });
    return;
  }
  if (isPlainObject(input) && isPlainObject(parsed)) {
    for (const [key, value] of Object.entries(input)) {
      if (Object.hasOwn(parsed, key)) {
        extraPaths(value, parsed[key], `${prefix}${key}.`, out);
      } else {
        out.push(`${prefix}${key}`);
      }
    }
  }
}

/**
 * The one way out of a `/v1` handler (INV-35): parses `data` with the response
 * schema, which strips unknown keys; in strict mode a key the schema does not declare throws
 * `ResponseShapeError`. A parse failure throws, and the error handler answers 500.
 */
export function respond<S extends z.ZodType>(
  c: Context<ApiEnv>,
  schema: S,
  data: z.input<S>,
  status: 200 | 201 | 202 = 200,
): Response {
  const parsed: unknown = schema.parse(data);
  if (c.get('respondMode') === 'strict') {
    const extra: string[] = [];
    extraPaths(data, parsed, '', extra);
    if (extra.length > 0) {
      throw new ResponseShapeError(extra);
    }
  }
  return c.json(parsed, status, { 'Content-Type': JSON_CONTENT_TYPE });
}
