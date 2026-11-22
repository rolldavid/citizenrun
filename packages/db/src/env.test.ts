import { EnvError } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { loadDbEnv } from './env.ts';

describe('loadDbEnv', () => {
  it('defaults APP_ENV to local', () => {
    const env = loadDbEnv({ DATABASE_URL: 'postgres://u@localhost/db' });
    expect(env.appEnv).toBe('local');
    expect(env.logLevel).toBe('info');
    expect(env.databaseUrl).toBe('postgres://u@localhost/db');
  });

  it('refuses a URL that is not Postgres', () => {
    let caught: unknown = null;
    try {
      loadDbEnv({ DATABASE_URL: 'http://x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvError);
    expect(caught instanceof EnvError ? caught.variables : null).toEqual(['DATABASE_URL']);
    expect(caught instanceof Error ? caught.message : '').not.toContain('http://x');
  });

  it('accepts the postgresql scheme and the stated APP_ENV and LOG_LEVEL', () => {
    const env = loadDbEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      APP_ENV: 'ci',
      LOG_LEVEL: 'debug',
    });
    expect(env).toEqual({
      databaseUrl: 'postgresql://u:p@localhost:5432/db',
      appEnv: 'ci',
      logLevel: 'debug',
    });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('names a missing DATABASE_URL and an unknown APP_ENV', () => {
    let caught: unknown = null;
    try {
      loadDbEnv({ APP_ENV: 'prod' });
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof EnvError ? caught.variables : null).toEqual([
      'APP_ENV',
      'DATABASE_URL',
    ]);
  });
});
