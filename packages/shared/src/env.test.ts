import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvError, parseEnv } from './env.ts';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.string().url(),
});

describe('parseEnv', () => {
  it('parseEnv reports names, never values', () => {
    let caught: unknown = null;
    try {
      parseEnv(schema, { PORT: 'seventy', DATABASE_URL: 'not a url PRIVATE-VALUE' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvError);
    const err = caught instanceof EnvError ? caught : null;
    expect(err?.variables).toEqual(['DATABASE_URL', 'PORT']);
    expect(err?.message).toBe('Invalid environment variables: DATABASE_URL, PORT');
    for (const text of [err?.message ?? '', JSON.stringify(err), String(err?.stack)]) {
      expect(text).not.toContain('seventy');
      expect(text).not.toContain('PRIVATE-VALUE');
    }
  });

  it('names a missing variable once', () => {
    expect(() => parseEnv(schema, { PORT: '8080' })).toThrow(
      'Invalid environment variables: DATABASE_URL',
    );
  });

  it('parseEnv returns a frozen object', () => {
    const env = parseEnv(schema, { PORT: '8080', DATABASE_URL: 'postgres://localhost/db' });
    expect(Object.isFrozen(env)).toBe(true);
    expect(env.PORT).toBe(8080);
  });
});
