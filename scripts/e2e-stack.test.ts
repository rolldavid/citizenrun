import { describe, expect, it } from 'vitest';
import {
  UsageError,
  makeReviewCode,
  parseStackArgs,
  reviewSignInEmails,
  stackBuckets,
  stackDatabaseName,
  stackDatabaseUrl,
  stackEnv,
  stackServerUrl,
  stackStoreEndpoint,
} from './e2e-stack.ts';

const BASE = { PATH: '/bin' };

function keysStartingWith(env: Record<string, string>, prefixes: readonly string[]): string[] {
  return Object.keys(env).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

describe('parseStackArgs', () => {
  it('is the seeded stack with nothing started or built by default', () => {
    expect(parseStackArgs([])).toEqual({ up: false, build: false, mode: 'seeded' });
  });

  it('sets all three flags', () => {
    expect(parseStackArgs(['--up', '--build', '--stand-in'])).toEqual({
      up: true,
      build: true,
      mode: 'standIn',
    });
  });

  it('throws a usage error on any other argument', () => {
    expect(() => parseStackArgs(['--nope'])).toThrow(UsageError);
    expect(() => parseStackArgs(['--up', 'extra'])).toThrow(/usage: tsx scripts\/e2e-stack\.ts/);
  });
});

describe('the stack names', () => {
  it('gives each form its database', () => {
    expect(stackDatabaseName('seeded')).toBe('citizenrun_e2e');
    expect(stackDatabaseName('standIn')).toBe('citizenrun_standin');
  });

  it('gives the stand-in the pipeline home data bucket and the seeded stack its own', () => {
    expect(stackBuckets('standIn').data).toBe('data');
    expect(stackBuckets('seeded').data).toBe('e2e-data');
    expect(stackBuckets('seeded')).toEqual({
      media: 'e2e-media',
      data: 'e2e-data',
      backups: 'e2e-backups',
      legal: 'e2e-legal',
    });
    expect(stackBuckets('standIn')).toEqual({
      media: 'standin-media',
      data: 'data',
      backups: 'standin-backups',
      legal: 'standin-legal',
    });
  });

  it('lists the 51 review sign-in addresses', () => {
    const emails = reviewSignInEmails().split(',');
    expect(emails).toHaveLength(51);
    expect(emails[0]).toBe('perf_01@example.test');
    expect(emails[1]).toBe('load_01@example.test');
    expect(emails[50]).toBe('load_50@example.test');
    expect(new Set(emails).size).toBe(51);
  });

  it('makes a six-digit review code with its leading zeros', () => {
    expect(makeReviewCode(() => 42)).toBe('000042');
    expect(makeReviewCode(() => 999_999)).toBe('999999');
  });

  it('asks for a code between 0 and 999999', () => {
    const asked: [number, number][] = [];
    makeReviewCode((min, max) => {
      asked.push([min, max]);
      return min;
    });
    expect(asked).toEqual([[0, 1_000_000]]);
  });
});

describe('the servers', () => {
  it('defaults to the compose stack on localhost', () => {
    expect(stackServerUrl({}).href).toBe(
      'postgres://citizenrun:citizenrun@localhost:5432/postgres',
    );
    expect(stackStoreEndpoint({})).toBe('http://localhost:8333');
    expect(stackDatabaseUrl('seeded', {})).toBe(
      'postgresql://citizenrun:citizenrun@localhost:5432/citizenrun_e2e',
    );
    expect(stackDatabaseUrl('standIn', {})).toBe(
      'postgresql://citizenrun:citizenrun@localhost:5432/citizenrun_standin',
    );
  });

  it('takes the server and the store from the harness settings of a job container', () => {
    const base = {
      TEST_DATABASE_URL: 'postgres://citizenrun:citizenrun@postgres:5432/postgres',
      TEST_S3_ENDPOINT: 'http://seaweedfs:8333',
    };
    expect(stackDatabaseUrl('seeded', base)).toBe(
      'postgresql://citizenrun:citizenrun@postgres:5432/citizenrun_e2e',
    );
    expect(stackStoreEndpoint(base)).toBe('http://seaweedfs:8333');
  });

  it('refuses a server or store away from this machine and the compose network', () => {
    expect(() =>
      stackServerUrl({ TEST_DATABASE_URL: 'postgres://u:p@db.example.test:5432/postgres' }),
    ).toThrow(/does not use/);
    expect(() => stackServerUrl({ TEST_DATABASE_URL: 'mysql://u:p@localhost/x' })).toThrow(
      /not a postgres URL/,
    );
    expect(() => stackStoreEndpoint({ TEST_S3_ENDPOINT: 'https://s3.example.test' })).toThrow(
      /does not use/,
    );
  });
});

describe('stackEnv', () => {
  it('gives the seeded API its settings and no worker-only bucket', () => {
    const env = stackEnv({ mode: 'seeded', role: 'api', base: BASE, reviewCode: null });
    expect(env.APP_ENV).toBe('ci');
    expect(env.NODE_ENV).toBe('production');
    expect(env.PORT).toBe('8080');
    expect(env.PUBLIC_URL).toBe('http://localhost:8080');
    expect(env.DATABASE_URL?.endsWith('/citizenrun_e2e')).toBe(true);
    expect(env.MEDIA_BUCKET).toBe('e2e-media');
    expect(env.MEDIA_ENDPOINT).toBe('http://localhost:8333');
    expect(env.ENABLE_DEV_ROUTES).toBe('true');
    expect(env.CLIENT_IP_HEADER).toBe('x-real-ip');
    expect(env.ADMIN_EMAILS).toBe('admin@example.test');
    expect(keysStartingWith(env, ['LEGAL_', 'DATA_', 'BACKUPS_'])).toEqual([]);
    expect(env.REVIEW_SIGNIN_CODE).toBeUndefined();
  });

  it('gives the seeded worker its three bucket sets and no dev routes', () => {
    const env = stackEnv({ mode: 'seeded', role: 'worker', base: BASE, reviewCode: null });
    expect(env.LEGAL_BUCKET).toBe('e2e-legal');
    expect(env.DATA_BUCKET).toBe('e2e-data');
    expect(env.BACKUPS_BUCKET).toBe('e2e-backups');
    expect(env.MEDIA_BUCKET).toBe('e2e-media');
    expect(env.ENABLE_DEV_ROUTES).toBeUndefined();
    expect(env.CLIENT_IP_HEADER).toBeUndefined();
    for (const prefix of ['MEDIA', 'DATA', 'BACKUPS', 'LEGAL']) {
      expect(env[`${prefix}_ENDPOINT`]).toBe('http://localhost:8333');
      expect(env[`${prefix}_REGION`]).toBe('us-east-1');
      expect(env[`${prefix}_ACCESS_KEY_ID`]).toBe('osdev');
      expect(env[`${prefix}_SECRET_ACCESS_KEY`]).toBe('osdev-secret-key');
    }
  });

  it('gives the stand-in API its database and the review sign-in', () => {
    const env = stackEnv({ mode: 'standIn', role: 'api', base: BASE, reviewCode: '123456' });
    expect(env.APP_ENV).toBe('local');
    expect(env.DATABASE_URL?.endsWith('/citizenrun_standin')).toBe(true);
    expect(env.MEDIA_BUCKET).toBe('standin-media');
    expect(env.REVIEW_SIGNIN_CODE).toBe('123456');
    expect(env.REVIEW_SIGNIN_EMAILS).toBe(reviewSignInEmails());
  });

  it('gives the stand-in worker the data bucket and no review sign-in', () => {
    const env = stackEnv({ mode: 'standIn', role: 'worker', base: BASE, reviewCode: '123456' });
    expect(env.DATA_BUCKET).toBe('data');
    expect(env.LEGAL_BUCKET).toBe('standin-legal');
    expect(env.REVIEW_SIGNIN_CODE).toBeUndefined();
    expect(env.REVIEW_SIGNIN_EMAILS).toBeUndefined();
  });

  it('passes no owner value from the shell to any child', () => {
    const base = {
      RESEND_API_KEY: 're_fixture',
      ANTHROPIC_API_KEY: 'fixture',
      GEO_API_KEY: 'fixture',
      PATH: '/bin',
      HOME: '/home/fixture',
      TEST_DATABASE_URL: 'postgres://citizenrun:citizenrun@127.0.0.1:55432/postgres',
      EMAIL_FROM: 'fixture@example.test',
    };
    for (const mode of ['seeded', 'standIn'] as const) {
      for (const role of ['api', 'worker'] as const) {
        const env = stackEnv({ mode, role, base, reviewCode: '000001' });
        expect(env.RESEND_API_KEY).toBeUndefined();
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(env.GEO_API_KEY).toBeUndefined();
        expect(env.EMAIL_FROM).toBeUndefined();
        expect(env.TEST_DATABASE_URL).toBeUndefined();
        expect(env.PATH).toBe('/bin');
        expect(env.HOME).toBe('/home/fixture');
        expect(env.DATABASE_URL).toBe(
          `postgresql://citizenrun:citizenrun@127.0.0.1:55432/${stackDatabaseName(mode)}`,
        );
      }
    }
  });

  it('copies only the six allow-listed shell variables that are set', () => {
    const env = stackEnv({
      mode: 'seeded',
      role: 'worker',
      base: { PATH: '/bin', TZ: 'UTC', NODE_OPTIONS: '--enable-source-maps', SHELL: '/bin/zsh' },
      reviewCode: null,
    });
    expect(env.TZ).toBe('UTC');
    expect(env.NODE_OPTIONS).toBe('--enable-source-maps');
    expect(env.SHELL).toBeUndefined();
    expect('LANG' in env).toBe(false);
    expect('TMPDIR' in env).toBe(false);
  });
});
