import { ApiError, ERROR_CODES } from '../errors.ts';
import type { ErrorCode } from '../errors.ts';
import { isForbiddenLogField } from './forbidden-fields.ts';

const MAX_DEPTH = 8;

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const HEX_GROUP = '[0-9a-f]{1,4}';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

// The masks of CTL-38, applied to every string value and every object key in this order.
const MASKS: readonly (readonly [RegExp, string])[] = [
  [EMAIL, '[email]'],
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
// A frame line that ends in a V8 location: `:line:column`, closed by `)` when the frame names a
// function.
const V8_LOCATED_FRAME = /^\s+at\s.*:\d+:\d+\)?$/;

// The name an error is logged under when its own is not an identifier.
const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const WITHHELD = '(message withheld)';
const UNREADABLE = '[unreadable]';

function maskString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of MASKS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// A frame line takes every mask, except that the email mask leaves a match holding a `/`: every
// installed package sits in a folder named `<name>@<version>`, and the frame must keep its file,
// line and column.
function maskFrame(line: string): string {
  let out = line;
  for (const [pattern, replacement] of MASKS) {
    out =
      pattern === EMAIL
        ? out.replace(pattern, (match) => (match.includes('/') ? match : replacement))
        : out.replace(pattern, replacement);
  }
  return out;
}

type RedactedError = {
  errorClass: string;
  errorCode?: string;
  message: string;
  stack: string;
};

// The text that follows the current message in the header V8 wrote when the error was built, one
// entry per place the message can start: the header is `name: message`, the name alone for an empty
// message, or the message alone for an empty name. Only the message is matched, never the name: a
// class field sets `name` after the stack is captured. Empty when the message is not a string or is
// not found closing the header.
function afterMessage(stack: string, message: unknown): string[] {
  if (typeof message !== 'string') {
    return [];
  }
  const newline = stack.indexOf('\n');
  const firstLineEnd = newline === -1 ? stack.length : newline;
  if (message === '') {
    return [stack.slice(firstLineEnd)];
  }
  const out: string[] = [];
  for (let start = 0; start <= firstLineEnd; start += 1) {
    const opensHere = start === 0 || stack.startsWith(': ', start - 2);
    if (opensHere && stack.startsWith(message, start)) {
      const rest = stack.slice(start + message.length);
      if (rest === '' || rest.startsWith('\n')) {
        out.push(rest);
      }
    }
  }
  return out;
}

// The frame lines of a stack and nothing else. V8 fixes the stack text when the error is built, and
// a message can span lines, any of which can look like a frame. Where the current message closes the
// header and is followed only by frame lines, the first of them ending in a location, those lines
// are the frames. Otherwise (the message was replaced, prefixed or cut short after the stack was
// captured, or is not a string) the header cannot be told from the frames, so of the lines after
// the first only those that end in a V8 location are kept: a leftover line of an earlier message is
// dropped unless it ends in `:line:column` itself.
function stackFrames(stack: string, message: unknown): string[] {
  for (const rest of afterMessage(stack, message)) {
    const lines = rest.trimEnd().split('\n').slice(1);
    const first = lines[0];
    if (
      first !== undefined &&
      V8_LOCATED_FRAME.test(first) &&
      lines.every((line) => V8_FRAME.test(line))
    ) {
      return lines;
    }
  }
  return stack
    .trimEnd()
    .split('\n')
    .slice(1)
    .filter((line) => V8_LOCATED_FRAME.test(line));
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
    stack = [maskString(header), ...stackFrames(err.stack, err.message).map(maskFrame)].join('\n');
  }
  return err instanceof ApiError && isErrorCode(err.code)
    ? { errorClass, errorCode: err.code, message, stack }
    : { errorClass, message, stack };
}

// The byte length of a binary value (D-804): a `Buffer`, any typed array, a `DataView` or an
// `ArrayBuffer`. Null for every other value.
function binaryLength(value: object): number | null {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  return null;
}

// A string under the key `stack` in an object that is not an `Error` keeps only its lines that end
// in a V8 location, each masked as a frame; every other line, the first included, is dropped
// (D-804).
function redactStackText(stack: string): string {
  return stack
    .split('\n')
    .filter((line) => V8_LOCATED_FRAME.test(line))
    .map(maskFrame)
    .join('\n');
}

// One property of a logged object. A getter that throws must not take down the log call, which is
// often reporting an error, so its key is logged with a fixed marker. A string under `stack` is
// read as a stack.
function walkProperty(
  value: object,
  key: string,
  depth: number,
  ancestors: WeakSet<object>,
): unknown {
  let item: unknown;
  try {
    item = Reflect.get(value, key);
  } catch {
    return UNREADABLE;
  }
  if (key === 'stack' && typeof item === 'string') {
    return redactStackText(item);
  }
  return walk(item, depth + 1, ancestors);
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
  const bytes = binaryLength(value);
  if (bytes !== null) {
    return `[binary ${String(bytes)} bytes]`;
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
    // A key takes the masks of a string value; a forbidden key is dropped by its original text, and
    // when two keys mask to the same text the later value is kept (D-804).
    const record: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (isForbiddenLogField(key)) {
        continue;
      }
      record[maskString(key)] = walkProperty(value, key, depth, ancestors);
    }
    out = record;
  }
  ancestors.delete(value);
  return out;
}

/**
 * A copy of `value` safe to log (CTL-38): forbidden keys are dropped at any depth, shaped secrets
 * and personal data in strings and in object keys are masked, a binary value becomes its length, and
 * an error becomes its class, a static message and its stack. Never mutates its input; null and
 * other primitives come back unchanged.
 */
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}
