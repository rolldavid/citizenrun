import { EnvError } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { loadDbEnv, loadSeedMediaEnv } from './env.ts';

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

describe('loadSeedMediaEnv', () => {
  const LOCAL = {
    MEDIA_BUCKET: 'media',
    MEDIA_ENDPOINT: 'http://localhost:8333',
    MEDIA_REGION: 'us-east-1',
    MEDIA_ACCESS_KEY_ID: 'osdev',
    MEDIA_SECRET_ACCESS_KEY: 'osdev-secret-key',
    S3_FORCE_PATH_STYLE: 'true',
  };

  it('reads the local store settings', () => {
    const env = loadSeedMediaEnv(LOCAL);
    expect(env).toEqual({
      bucket: 'media',
      endpoint: 'http://localhost:8333',
      region: 'us-east-1',
      accessKeyId: 'osdev',
      secretAccessKey: 'osdev-secret-key',
      forcePathStyle: true,
    });
    expect(Object.isFrozen(env)).toBe(true);
    expect(loadSeedMediaEnv({ ...LOCAL, S3_FORCE_PATH_STYLE: undefined }).forcePathStyle).toBe(
      false,
    );
  });

  it('the seed media settings are required', () => {
    let caught: unknown = null;
    try {
      loadSeedMediaEnv({ ...LOCAL, MEDIA_BUCKET: undefined });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvError);
    expect(caught instanceof EnvError ? caught.variables : null).toEqual(['MEDIA_BUCKET']);
    expect(caught instanceof Error ? caught.message : '').not.toContain('osdev-secret-key');
  });
});
