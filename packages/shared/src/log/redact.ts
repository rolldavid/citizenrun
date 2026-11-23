import { ApiError, ERROR_CODES } from '../errors.ts';
import type { ErrorCode } from '../errors.ts';
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

// The name an error is logged under when its own is not an identifier.
const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const WITHHELD = '(message withheld)';

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

// The frame lines of a stack and nothing else. A message can span lines, and any of its lines can
// look like a frame, so the stack is first cut after the message, and then only the trailing run of
// frame lines is kept: whatever is left of the message (one changed after the stack was captured,
// or a header that is not `name: message`) is never part of that run.
function stackFrames(stack: string, message: unknown): string[] {
  let rest = stack;
  if (typeof message === 'string' && message !== '') {
    const end = rest.indexOf(message);
    if (end !== -1) {
      rest = rest.slice(end + message.length);
    }
  }
  const lines = rest.trimEnd().split('\n');
  let start = lines.length;
  while (start > 0 && V8_FRAME.test(lines[start - 1] ?? '')) {
    start -= 1;
  }
  return lines.slice(start);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);
}

// An ApiError is logged with its code's registry text, never its own message, which a subclass or
// a later assignment can have replaced.
function staticMessage(err: Error): string {
  if (err instanceof ApiError && isErrorCode(err.code)) {
    return ERROR_CODES[err.code].message;
  }
  return WITHHELD;
}

// An error keeps its class, a static message and its stack frames, and nothing else (no `detail`,
// `cause`, `query` or `parameters`), because a database or provider message can hold the values.
function redactError(err: Error): RedactedError {
  const errorClass =
    typeof err.name === 'string' && ERROR_CLASS_PATTERN.test(err.name) ? err.name : 'Error';
  const message = staticMessage(err);
  const header = `${errorClass}: ${message}`;
  let stack = header;
  if (typeof err.stack === 'string') {
    stack = maskString([header, ...stackFrames(err.stack, err.message)].join('\n'));
  }
  return err instanceof ApiError && isErrorCode(err.code)
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
