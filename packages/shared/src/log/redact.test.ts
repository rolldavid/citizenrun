import { describe, expect, it } from 'vitest';
import { marker } from '../testing/marker.ts';
import { ApiError } from '../errors.ts';
import { FORBIDDEN_LOG_FIELDS, isForbiddenLogField } from './forbidden-fields.ts';
import { redact } from './redact.ts';

function variants(name: string): string[] {
  const forms = [name, name.toUpperCase()];
  if (name.length > 1) {
    forms.push(`${name.slice(0, 1)}_${name.slice(1)}`, `${name.slice(0, 1)}-${name.slice(1)}`);
  }
  return forms;
}

function hasKeyDeep(value: unknown, key: string): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  return Object.entries(value).some(([k, v]) => k === key || hasKeyDeep(v, key));
}

// The stack of a redacted error.
function stackOf(value: unknown): string {
  const stack: unknown =
    value !== null && typeof value === 'object' ? Reflect.get(value, 'stack') : undefined;
  if (typeof stack !== 'string') {
    throw new Error('The redacted value has no stack.');
  }
  return stack;
}

describe('forbidden fields', () => {
  it('holds every name once, lower case, without separators, and no bare state', () => {
    expect(new Set(FORBIDDEN_LOG_FIELDS).size).toBe(FORBIDDEN_LOG_FIELDS.length);
    expect(FORBIDDEN_LOG_FIELDS).toHaveLength(83);
    for (const name of FORBIDDEN_LOG_FIELDS) {
      expect(name).toMatch(/^[a-z]+$/);
    }
    expect(FORBIDDEN_LOG_FIELDS.slice(0, 14)).toEqual([
      'authorization',
      'cookie',
      'token',
      'code',
      'email',
      'lat',
      'lng',
      'address',
      'q',
      'query',
      'body',
      'caption',
      'message',
      'url',
    ]);
    expect(isForbiddenLogField('state')).toBe(false);
    expect(isForbiddenLogField('Apple_State')).toBe(true);
    expect(isForbiddenLogField('errorCode')).toBe(false);
  });
});

describe('redact', () => {
  it('drops every forbidden key', () => {
    const secret = marker();
    for (const name of FORBIDDEN_LOG_FIELDS) {
      for (const key of variants(name)) {
        const input = { outer: { inner: { [key]: secret, kept: 'yes' } }, [key]: secret };
        const output = redact(input);
        expect(hasKeyDeep(output, key)).toBe(false);
        expect(JSON.stringify(output)).not.toContain(secret);
        expect(output).toEqual({ outer: { inner: { kept: 'yes' } } });
      }
    }
  });

  it('drops a forbidden key inside an array', () => {
    const secret = marker();
    expect(redact({ items: [{ email: secret, id: 1 }] })).toEqual({ items: [{ id: 1 }] });
  });

  it('keeps a bare state', () => {
    expect(redact({ state: 'NC' })).toEqual({ state: 'NC' });
  });

  it('masks shaped values', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['a@b.example.test', '[email]'],
      ['Bearer abc.def', 'Bearer [token]'],
      ['https://x.example.test/k?X-Amz-Signature=abc', '[presigned-url]'],
      ['eyJa.eyJb.c', '[jwt]'],
      ['ExponentPushToken[xyz]', '[push-token]'],
      ['re_123abc', '[key]'],
      ['A'.repeat(40), '[opaque]'],
      ['203.0.113.7', '[ip]'],
      ['2001:db8::1', '[ip]'],
      ['30.0043, -39.9956', '[coords]'],
    ];
    for (const [value, masked] of cases) {
      expect(redact({ info: value })).toEqual({ info: masked });
    }
  });

  it('masks inside longer text and leaves ordinary text alone', () => {
    expect(redact({ info: 'sent to a@b.example.test from 203.0.113.7.' })).toEqual({
      info: 'sent to [email] from [ip].',
    });
    const plain = 'request.done at 2027-03-05T22:00:00.000Z took 41 ms for 0195d2c4-1c3e-7b2a';
    expect(redact({ info: plain })).toEqual({ info: plain });
    expect(redact({ info: 'A'.repeat(39) })).toEqual({ info: 'A'.repeat(39) });
  });

  it('logs an error as class, static message and stack', () => {
    const err = Object.assign(
      new Error('duplicate key value violates unique constraint (email)=(x@example.test)'),
      {
        name: 'DatabaseError',
        detail: 'Key (email)=(x@example.test) already exists.',
        code: '23505',
      },
    );
    const out = redact(err);
    expect(out).toMatchObject({ errorClass: 'DatabaseError', message: '(message withheld)' });
    const stack = (out as { stack: string }).stack; // the shape matched on the line above
    expect(stack.split('\n')[0]).toBe('DatabaseError: (message withheld)');
    expect(stack.split('\n').length).toBeGreaterThan(1);
    expect(out).not.toHaveProperty('detail');
    expect(out).not.toHaveProperty('errorCode');
    const text = JSON.stringify(out);
    expect(text).not.toContain('x@example.test');
    expect(text).not.toContain('duplicate key');
  });

  it('withholds every line of a message that spans lines', () => {
    const out = redact({ err: new Error('first line\nsecond line with a secret') });
    const text = JSON.stringify(out);
    expect(text).not.toContain('secret');
    expect(text).not.toContain('first line');
  });

  it('withholds a message line shaped like a stack frame', () => {
    const error = new Error(
      "Failed query: select id,\n  (created_at\n    at time zone 'UTC') as day\n" +
        'from users where name = $1\nparams: Jane Fixture, 12 Elm Street',
    );
    const out = redact({ error }) as { error: { stack: string } }; // an error redacts to this shape
    const text = JSON.stringify(out);
    for (const part of ['time zone', 'from users', 'params', 'Jane Fixture', 'Elm Street']) {
      expect(text).not.toContain(part);
    }
    const lines = out.error.stack.split('\n');
    expect(lines[0]).toBe('Error: (message withheld)');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^\s+at\s/);
    }
  });

  it('withholds a message whose last line is shaped like a frame', () => {
    const out = redact(new Error("select now()\n    at time zone 'UTC'")) as { stack: string };
    expect(JSON.stringify(out)).not.toContain('time zone');
    const lines = out.stack.split('\n');
    expect(lines[0]).toBe('Error: (message withheld)');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^\s+at\s/);
    }
  });

  it('logs the header alone when the stack has no frames', () => {
    const err = new Error('first line\nparams: fixture-private-value');
    err.stack = 'Error: first line\nparams: fixture-private-value';
    expect(redact(err)).toMatchObject({ stack: 'Error: (message withheld)' });
  });

  describe('a message changed after the stack was captured', () => {
    const MESSAGE_TEXT = ['select', 'now()', 'time zone', 'SECRET', 'fixture-replacement'];

    function capturedError(): Error {
      const err = new Error("select now()\n    at time zone 'SECRET'");
      expect(err.stack).toContain('SECRET'); // reading the stack fixes its text
      return err;
    }

    function expectFramesOnly(out: unknown): void {
      const text = JSON.stringify(out);
      for (const part of MESSAGE_TEXT) {
        expect(text).not.toContain(part);
      }
      const lines = stackOf(out).split('\n');
      expect(lines[0]).toBe('Error: (message withheld)');
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines.slice(1)) {
        expect(line).toMatch(/^\s+at\s/);
      }
    }

    it('stack read, then message replaced', () => {
      const err = capturedError();
      err.message = 'fixture-replacement';
      expectFramesOnly(redact(err));
    });

    it('stack read, then message prefixed', () => {
      const err = capturedError();
      err.message = `fixture-replacement: ${err.message}`;
      expectFramesOnly(redact(err));
    });

    it('stack read, then message cut short', () => {
      const err = capturedError();
      err.message = 'select now()';
      expectFramesOnly(redact(err));
    });

    it('a message that is not a string', () => {
      const err = capturedError();
      Reflect.set(err, 'message', 42);
      expectFramesOnly(redact(err));
    });
  });

  it('an error with an empty message keeps its frames', () => {
    const lines = stackOf(redact(new Error())).split('\n');
    expect(lines[0]).toBe('Error: (message withheld)');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^\s+at\s/);
    }
  });

  it('keeps the file, line and column of a frame under the package store', () => {
    const frame =
      '    at parse (file:///app/node_modules/.pnpm/zod@4.6.7/node_modules/zod/v4/classic/schemas.js:1218:28)';
    const err = new Error('fixture failure');
    err.stack = `Error: fixture failure\n${frame}`;
    expect(stackOf(redact(err))).toBe(`Error: (message withheld)\n${frame}`);
  });

  it('masks an address inside a frame line', () => {
    const err = new Error('fixture failure');
    err.stack =
      'Error: fixture failure\n    at run (file:///app/x.js:1:2)\n    at handler (user@example.test)';
    const stack = stackOf(redact(err));
    expect(stack).not.toContain('user@example.test');
    expect(stack.split('\n')[2]).toBe('    at handler [email]');
  });

  it('keeps the message of an ApiError', () => {
    expect(redact(new ApiError('not_found'))).toMatchObject({
      errorClass: 'ApiError',
      errorCode: 'not_found',
      message: 'Not found.',
    });
  });

  it('logs the registry text of an ApiError whose message was replaced', () => {
    const err = new ApiError('rate_limited');
    err.message = 'Too many requests from 203.0.113.7 for fixture-private-value';
    const out = redact(err);
    expect(out).toMatchObject({
      errorClass: 'ApiError',
      errorCode: 'rate_limited',
      message: 'Too many requests.',
    });
    expect(stackOf(out).split('\n')[0]).toBe('ApiError: Too many requests.');
    expect(JSON.stringify(out)).not.toContain('fixture-private-value');
  });

  it('logs the registry text of an ApiError subclass that sets its own message', () => {
    class FixtureApiError extends ApiError {
      constructor() {
        super('not_found');
        this.message = 'No row for fixture-private-value';
      }
    }
    const out = redact(new FixtureApiError());
    expect(out).toMatchObject({
      errorClass: 'ApiError',
      errorCode: 'not_found',
      message: 'Not found.',
    });
    expect(JSON.stringify(out)).not.toContain('fixture-private-value');
  });

  it('withholds the message and code of an ApiError whose code is not a registry key', () => {
    const err = new ApiError('internal');
    err.message = 'fixture-private-value';
    Reflect.set(err, 'code', 'fixture-private-code');
    const out = redact(err);
    expect(out).toMatchObject({ errorClass: 'ApiError', message: '(message withheld)' });
    expect(out).not.toHaveProperty('errorCode');
    const text = JSON.stringify(out);
    expect(text).not.toContain('fixture-private-value');
    expect(text).not.toContain('fixture-private-code');
  });

  it('logs an error whose name is not an identifier as Error', () => {
    class FixtureNamedError extends Error {}
    Object.defineProperty(FixtureNamedError.prototype, 'name', {
      value: 'Caller a@b.example.test at 203.0.113.7 typed SECRETWORD',
    });
    const out = redact(new FixtureNamedError('fixture failure'));
    expect(out).toMatchObject({ errorClass: 'Error', message: '(message withheld)' });
    expect(stackOf(out).split('\n')[0]).toBe('Error: (message withheld)');
    const text = JSON.stringify(out);
    for (const part of ['Caller', 'a@b.example.test', '203.0.113.7', 'typed', 'SECRETWORD']) {
      expect(text).not.toContain(part);
    }
  });

  it('does not mutate its input and survives a cycle', () => {
    const input: Record<string, unknown> = { a: 1, token: 't', nested: { email: 'e', b: [1, 2] } };
    input.self = input;
    const before = structuredClone(input);
    const out = redact(input);
    expect(input).toEqual(before);
    expect(out).toEqual({ a: 1, nested: { b: [1, 2] }, self: '[circular]' });
  });

  it('a getter that throws is logged as [unreadable]', () => {
    const input = {
      kept: 'yes',
      get broken(): string {
        throw new Error('fixture getter failure');
      },
      after: 2,
    };
    expect(redact({ outer: input })).toEqual({
      outer: { kept: 'yes', broken: '[unreadable]', after: 2 },
    });
  });

  it('stops at depth eight', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 12; i += 1) {
      deep = { next: deep };
    }
    expect(JSON.stringify(redact(deep))).toContain('[depth]');
    expect(JSON.stringify(redact(deep))).not.toContain('leaf');
  });

  it('a binary value is logged as its length', () => {
    const values = (): Record<string, unknown> => ({
      buffer: Buffer.from('ab'),
      bytes: new Uint8Array(3),
      raw: new ArrayBuffer(4),
      view: new DataView(new ArrayBuffer(5)),
      wide: new Float64Array(2),
    });
    const expected = {
      buffer: '[binary 2 bytes]',
      bytes: '[binary 3 bytes]',
      raw: '[binary 4 bytes]',
      view: '[binary 5 bytes]',
      wide: '[binary 16 bytes]',
    };
    expect(redact(values())).toEqual(expected);
    expect(redact({ a: { b: { c: values() } } })).toEqual({ a: { b: { c: expected } } });
    expect(redact({ list: [Buffer.from('abc')] })).toEqual({ list: ['[binary 3 bytes]'] });
    expect(redact(Buffer.from('abcd'))).toBe('[binary 4 bytes]');
    const secret = marker();
    expect(JSON.stringify(redact({ a: { b: { c: Buffer.from(secret) } } }))).not.toContain(secret);
  });

  it('object keys are masked', () => {
    expect(redact({ 'a@example.test': 1 })).toEqual({ '[email]': 1 });
    expect(redact({ '203.0.113.7': 'seen' })).toEqual({ '[ip]': 'seen' });
    expect(redact({ outer: { [`sent to a@example.test`]: true } })).toEqual({
      outer: { 'sent to [email]': true },
    });
    expect(redact({ 'Bearer abc.def': 1, kept: 2 })).toEqual({ 'Bearer [token]': 1, kept: 2 });
  });

  it('keeps the later value when two keys mask to the same text', () => {
    expect(redact({ 'a@example.test': 1, 'b@example.test': 2 })).toEqual({ '[email]': 2 });
    expect(redact({ '203.0.113.7': 'first', '198.51.100.9': 'second' })).toEqual({
      '[ip]': 'second',
    });
  });

  it('a forbidden key is dropped by its original text before its key is masked', () => {
    expect(redact({ email: 'x', token: 'y', kept: 1 })).toEqual({ kept: 1 });
  });

  it('a stack outside an error keeps only its frames', () => {
    const secret = marker();
    const frame = '    at f (/app/x.js:1:2)';
    const shaped = {
      name: 'E',
      message: `marker-${secret}`,
      stack: `E: marker-${secret}\n${frame}`,
    };
    const out = redact(shaped);
    expect(out).toEqual({ name: 'E', stack: frame });
    expect(JSON.stringify(out)).not.toContain(secret);

    const spanning = {
      stack: [
        `E: first ${secret}`,
        `second line ${secret}`,
        `    at ${secret} (not a location)`,
        '    at g (/app/y.js:3:4)',
        `trailing ${secret}`,
        '    at /app/z.js:5:6',
      ].join('\n'),
    };
    const nested = redact({ a: { b: spanning } });
    expect(nested).toEqual({
      a: { b: { stack: '    at g (/app/y.js:3:4)\n    at /app/z.js:5:6' } },
    });
    expect(JSON.stringify(nested)).not.toContain(secret);
  });

  it('a stack outside an error masks its frames and keeps nothing without one', () => {
    expect(redact({ stack: '    at f (/srv/a@b.example.test/x.js:1:2)' })).toEqual({
      stack: '    at f (/srv/a@b.example.test/x.js:1:2)',
    });
    expect(redact({ stack: '    at f (203.0.113.7/x.js:1:2)' })).toEqual({
      stack: '    at f ([ip]/x.js:1:2)',
    });
    expect(redact({ stack: 'no frames here' })).toEqual({ stack: '' });
    expect(redact({ stack: 7 })).toEqual({ stack: 7 });
  });

  it('header-shaped names are dropped', () => {
    const secret = marker();
    for (const key of [
      'x-api-key',
      'Proxy-Authorization',
      'x_auth_token',
      'X-Amz-Security-Token',
    ]) {
      const input = {
        [key]: secret,
        a: { [key]: secret, b: { [key]: secret, c: { [key]: secret } } },
      };
      const out = redact(input);
      expect(out).toEqual({ a: { b: { c: {} } } });
      expect(JSON.stringify(out)).not.toContain(secret);
    }
  });

  it('makes values JSON can write', () => {
    expect(redact({ n: 10n, when: new Date('2027-03-05T22:00:00.000Z'), f: () => 1 })).toEqual({
      n: '10',
      when: '2027-03-05T22:00:00.000Z',
      f: undefined,
    });
  });
});
