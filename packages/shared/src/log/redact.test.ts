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

describe('forbidden fields', () => {
  it('holds every name once, lower case, without separators, and no bare state', () => {
    expect(new Set(FORBIDDEN_LOG_FIELDS).size).toBe(FORBIDDEN_LOG_FIELDS.length);
    expect(FORBIDDEN_LOG_FIELDS).toHaveLength(79);
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

  it('keeps the message of an ApiError', () => {
    expect(redact(new ApiError('not_found'))).toMatchObject({
      errorClass: 'ApiError',
      errorCode: 'not_found',
      message: 'Not found.',
    });
  });

  it('does not mutate its input and survives a cycle', () => {
    const input: Record<string, unknown> = { a: 1, token: 't', nested: { email: 'e', b: [1, 2] } };
    input.self = input;
    const before = structuredClone(input);
    const out = redact(input);
    expect(input).toEqual(before);
    expect(out).toEqual({ a: 1, nested: { b: [1, 2] }, self: '[circular]' });
  });

  it('stops at depth eight', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 12; i += 1) {
      deep = { next: deep };
    }
    expect(JSON.stringify(redact(deep))).toContain('[depth]');
    expect(JSON.stringify(redact(deep))).not.toContain('leaf');
  });

  it('makes values JSON can write', () => {
    expect(redact({ n: 10n, when: new Date('2027-03-05T22:00:00.000Z'), f: () => 1 })).toEqual({
      n: '10',
      when: '2027-03-05T22:00:00.000Z',
      f: undefined,
    });
  });
});
