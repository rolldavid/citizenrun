import { ApiError } from '../errors.ts';
import { isForbiddenLogField } from './forbidden-fields.ts';

const MAX_DEPTH = 8;

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const HEX_GROUP = '[0-9a-f]{1,4}';

// The masks of CTL-38, applied to every string value in this order.
const MASKS: readonly (readonly [RegExp, string])[] = [
  [/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]'],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]'],
  [/\bBearer\s+[\w.~+/-]+=*/gi, 'Bearer [token]'],
  [/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*X-Amz-[^\s"'<>]*/gi, '[presigned-url]'],
  [/ExponentPushToken\[[^\]]+\]/g, '[push-token]'],
  [/\b(re_|whsec_|sk-ant-)[\w-]+/g, '[key]'],
  [/[A-Za-z0-9_-]{40,}/g, '[opaque]'],
  [new RegExp(`(?<![\\d.])(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}(?![\\d.]*\\d)`, 'g'), '[ip]'],
  [
    new RegExp(
      `(?<![\\w:])(?:(?:${HEX_GROUP}:){3,7}${HEX_GROUP}` +
        `|(?:${HEX_GROUP}(?::${HEX_GROUP})*)?::(?:${HEX_GROUP}(?::${HEX_GROUP})*)?)(?![\\w:])`,
      'gi',
    ),
    '[ip]',
  ],
  [/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, '[coords]'],
];

const V8_FRAME = /^\s+at\s/;

function maskString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of MASKS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

type RedactedError = {
  errorClass: string;
  errorCode?: string;
  message: string;
  stack: string;
};

// An error keeps its class, a static message and its stack, and nothing else (no `detail`, `cause`,
// `query` or `parameters`), because a database or provider message can hold the values.
function redactError(err: Error): RedactedError {
  const errorClass = maskString(err.name);
  const message = err instanceof ApiError ? err.message : '(message withheld)';
  const header = `${errorClass}: ${message}`;
  let stack = header;
  if (typeof err.stack === 'string') {
    const lines = err.stack.split('\n');
    // The message can span several lines, so everything before the first frame is replaced.
    const firstFrame = lines.findIndex((line, index) => index > 0 && V8_FRAME.test(line));
    const frames = firstFrame === -1 ? lines.slice(1) : lines.slice(firstFrame);
    stack = maskString([header, ...frames].join('\n'));
  }
  return err instanceof ApiError
    ? { errorClass, errorCode: err.code, message, stack }
    : { errorClass, message, stack };
}

function walk(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return maskString(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Error) {
    return redactError(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (ancestors.has(value)) {
    return '[circular]';
  }
  if (depth > MAX_DEPTH) {
    return '[depth]';
  }
  ancestors.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.map((item: unknown) => walk(item, depth + 1, ancestors));
  } else {
    const record: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!isForbiddenLogField(key)) {
        record[key] = walk(item, depth + 1, ancestors);
      }
    }
    out = record;
  }
  ancestors.delete(value);
  return out;
}

/**
 * A copy of `value` safe to log (CTL-38): forbidden keys are dropped at any depth, shaped secrets
 * and personal data in strings are masked, and an error becomes its class, a static message and its
 * stack. Never mutates its input; null and other primitives come back unchanged.
 */
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}
