import { generateKeyPairSync } from 'node:crypto';
import { EnvError, createLogger } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { WORKER_OWNER_INPUTS, loadEnv, logMissingOwnerInputs, missingOwnerInputs } from './env.ts';

const FIXTURE_KEY = 're_fixture_0000000000';
const FIXTURE_FROM = 'Fixture <alerts@mail.example.test>';
const FIXTURE_ADMINS = 'admin@example.test';
// The local constant of the .env.example files: never a real secret.
const LOCAL_APP_SECRET = '0'.repeat(64);
const APPLE_VARIABLES = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'] as const;
const MEDIA_VARIABLES = [
  'MEDIA_BUCKET',
  'MEDIA_ENDPOINT',
  'MEDIA_REGION',
  'MEDIA_ACCESS_KEY_ID',
  'MEDIA_SECRET_ACCESS_KEY',
] as const;
const DATA_VARIABLES = [
  'DATA_BUCKET',
  'DATA_ENDPOINT',
  'DATA_REGION',
  'DATA_ACCESS_KEY_ID',
  'DATA_SECRET_ACCESS_KEY',
] as const;
const APPLE_OWNER_INPUTS = APPLE_VARIABLES.map((variable) => ({
  variable,
  ownerInput: 'OI-apple-identifiers',
}));

/** A PKCS#8 PEM made for the test, never a real key. */
function fixturePem(): string {
  return generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

type Source = Record<string, string | undefined>;

function infra(appEnv: string, extra: Source = {}): Source {
  return {
    NODE_ENV: 'test',
    APP_ENV: appEnv,
    DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/fixture',
    PUBLIC_URL: 'https://app.example.test',
    BACKUPS_BUCKET: 'backups',
    BACKUPS_ENDPOINT: 'http://localhost:8333',
    BACKUPS_REGION: 'us-east-1',
    BACKUPS_ACCESS_KEY_ID: 'fixture-access',
    BACKUPS_SECRET_ACCESS_KEY: 'fixture-secret',
    MEDIA_BUCKET: 'media',
    MEDIA_ENDPOINT: 'http://localhost:8333',
    MEDIA_REGION: 'us-east-1',
    MEDIA_ACCESS_KEY_ID: 'fixture-access',
    MEDIA_SECRET_ACCESS_KEY: 'fixture-secret',
    // The values of apps/worker/.env.example.
    DATA_BUCKET: 'dev-data',
    DATA_ENDPOINT: 'http://localhost:8333',
    DATA_REGION: 'us-east-1',
    DATA_ACCESS_KEY_ID: 'osdev',
    DATA_SECRET_ACCESS_KEY: 'osdev-secret-key',
    APP_SECRET: LOCAL_APP_SECRET,
    ...extra,
  };
}

function deployed(appEnv: 'staging' | 'production', extra: Source = {}): Source {
  return infra(appEnv, {
    RESEND_API_KEY: FIXTURE_KEY,
    EMAIL_FROM: FIXTURE_FROM,
    ADMIN_EMAILS: FIXTURE_ADMINS,
    ...extra,
  });
}

function refusal(source: Source): EnvError {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof EnvError) {
      return error;
    }
    throw error;
  }
  throw new Error('loadEnv accepted the source');
}

function captured(): {
  lines: Record<string, unknown>[];
  raw: string[];
  logger: ReturnType<typeof createLogger>;
} {
  const raw: string[] = [];
  const logger = createLogger({
    service: 'worker',
    level: 'debug',
    sink: (line) => {
      raw.push(line);
    },
  });
  return {
    raw,
    get lines() {
      return raw.map((line) => JSON.parse(line) as Record<string, unknown>); // lines the logger wrote as JSON objects
    },
    logger,
  };
}

const LOGGER_KEYS = ['time', 'level', 'service', 'event'];

describe('loadEnv', () => {
  it('starts with no owner input in local and ci', () => {
    for (const appEnv of ['local', 'ci']) {
      const env = loadEnv(infra(appEnv));
      expect(env.RESEND_API_KEY).toBeNull();
      expect(env.EMAIL_FROM).toBeNull();
      expect(env.ADMIN_EMAILS).toBeNull();
      expect(missingOwnerInputs(env)).toEqual([
        { variable: 'RESEND_API_KEY', ownerInput: 'OI-resend' },
        { variable: 'EMAIL_FROM', ownerInput: 'OI-resend' },
        { variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' },
        ...APPLE_OWNER_INPUTS,
      ]);
      const log = captured();
      logMissingOwnerInputs(env, log.logger);
      expect(log.lines).toHaveLength(6);
      expect(log.lines.map((line) => line.variable)).toEqual([
        'RESEND_API_KEY',
        'EMAIL_FROM',
        'ADMIN_EMAILS',
        ...APPLE_VARIABLES,
      ]);
      for (const line of log.lines) {
        expect(line.level).toBe('warn');
        expect(line.event).toBe('env.input_missing');
        expect(Object.keys(line).sort()).toEqual([...LOGGER_KEYS, 'ownerInput', 'variable'].sort());
      }
      expect(log.lines.map((line) => line.ownerInput)).toEqual([
        'OI-resend',
        'OI-resend',
        'OI-admin-emails',
        'OI-apple-identifiers',
        'OI-apple-identifiers',
        'OI-apple-identifiers',
      ]);
    }
  });

  it('starts in local with no owner input', () => {
    const env = loadEnv(infra('local', { APPLE_BUNDLE_ID: undefined }));
    for (const variable of APPLE_VARIABLES) {
      expect(env[variable]).toBeNull();
    }
    expect(env.EMAIL_MONTHLY_QUOTA).toBe(3000);
    expect(env.EMAIL_DAILY_QUOTA).toBe(100);
    expect(env.APP_SECRET).toBe(LOCAL_APP_SECRET);
    expect(env.APP_SECRET_PREVIOUS).toBeNull();
    const log = captured();
    logMissingOwnerInputs(env, log.logger);
    const missing = log.lines
      .filter((line) => line.event === 'env.input_missing')
      .map((line) => line.variable);
    expect(missing).toEqual(['RESEND_API_KEY', 'EMAIL_FROM', 'ADMIN_EMAILS', ...APPLE_VARIABLES]);
    // The worker reads neither client id (D-423), so neither is reported.
    expect(missing).not.toContain('APPLE_BUNDLE_ID');
    expect(missing).not.toContain('APPLE_SERVICES_ID');
  });

  it('lists the six owner inputs in report order', () => {
    expect(WORKER_OWNER_INPUTS.map((row) => row.variable)).toEqual([
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'ADMIN_EMAILS',
      ...APPLE_VARIABLES,
    ]);
  });

  it('stops without the media bucket', () => {
    for (const variable of MEDIA_VARIABLES) {
      expect(refusal(infra('ci', { [variable]: undefined })).variables).toEqual([variable]);
      expect(refusal(deployed('staging', { [variable]: undefined })).variables).toEqual([variable]);
    }
    const env = loadEnv(infra('ci'));
    expect(env.MEDIA_BUCKET).toBe('media');
    expect(env.MEDIA_ENDPOINT).toBe('http://localhost:8333');
    expect(refusal(infra('ci', { MEDIA_ENDPOINT: 'ftp://store.example.test' })).variables).toEqual([
      'MEDIA_ENDPOINT',
    ]);
  });

  it('stops without the data bucket', () => {
    const values = infra('ci');
    for (const variable of DATA_VARIABLES) {
      const missing = refusal(infra('ci', { [variable]: undefined }));
      expect(missing.variables).toEqual([variable]);
      expect(refusal(deployed('staging', { [variable]: undefined })).variables).toEqual([variable]);
      // The refusal names the variable and holds none of the values.
      for (const name of DATA_VARIABLES) {
        const value = values[name] ?? '';
        expect(missing.message).not.toContain(value);
        expect(JSON.stringify(missing.variables)).not.toContain(value);
      }
    }
    const env = loadEnv(values);
    expect(env.DATA_BUCKET).toBe('dev-data');
    expect(env.DATA_ENDPOINT).toBe('http://localhost:8333');
    expect(refusal(infra('ci', { DATA_ENDPOINT: 'ftp://store.example.test' })).variables).toEqual([
      'DATA_ENDPOINT',
    ]);
  });

  it('stops without APP_SECRET', () => {
    for (const source of [
      infra('local', { APP_SECRET: undefined }),
      infra('ci', { APP_SECRET: '' }),
      deployed('staging', { APP_SECRET: undefined }),
    ]) {
      expect(refusal(source).variables).toEqual(['APP_SECRET']);
    }
    const value = `${'a'.repeat(63)}g`;
    const error = refusal(infra('ci', { APP_SECRET_PREVIOUS: value }));
    expect(error.variables).toEqual(['APP_SECRET_PREVIOUS']);
    expect(error.message).not.toContain(value);
    const upper = 'ABCDEF0123456789'.repeat(4);
    expect(loadEnv(infra('ci', { APP_SECRET: upper })).APP_SECRET).toBe(upper.toLowerCase());
  });

  it('apple values', () => {
    const pem = fixturePem();
    const fixture = {
      APPLE_TEAM_ID: 'FIXTURE001',
      APPLE_KEY_ID: 'FIXTURE002',
      APPLE_PRIVATE_KEY: pem,
    };
    const all = loadEnv(infra('local', fixture));
    expect(all.APPLE_TEAM_ID).toBe('FIXTURE001');
    expect(all.APPLE_KEY_ID).toBe('FIXTURE002');
    expect(all.APPLE_PRIVATE_KEY).toBe(pem.trim());
    for (const left of APPLE_VARIABLES) {
      const env = loadEnv(infra('local', { ...fixture, [left]: undefined }));
      for (const variable of APPLE_VARIABLES) {
        if (variable === left) {
          expect(env[variable]).toBeNull();
        } else {
          expect(env[variable]).not.toBeNull();
        }
      }
      const log = captured();
      logMissingOwnerInputs(env, log.logger);
      expect(
        log.lines
          .filter((line) => line.event === 'env.input_missing')
          .map((line) => line.variable)
          .filter((variable) => String(variable).startsWith('APPLE_')),
      ).toEqual([left]);
    }
    // A key written with literal \n sequences gives the same key.
    const escaped = pem.trim().replaceAll('\n', '\\n');
    expect(escaped).not.toContain('\n');
    expect(loadEnv(infra('local', { APPLE_PRIVATE_KEY: escaped })).APPLE_PRIVATE_KEY).toBe(
      pem.trim(),
    );
    // A malformed value is unset in local and stops a deployed worker.
    const bad = loadEnv(infra('local', { APPLE_TEAM_ID: 'fixture001' }));
    expect(bad.APPLE_TEAM_ID).toBeNull();
    expect(bad.ownerInputReport.invalid).toEqual([
      { variable: 'APPLE_TEAM_ID', ownerInput: 'OI-apple-identifiers' },
    ]);
    expect(refusal(deployed('staging', { APPLE_TEAM_ID: 'fixture001' })).variables).toEqual([
      'APPLE_TEAM_ID',
    ]);
  });

  it('ignores APPLE_BUNDLE_ID and APPLE_SERVICES_ID', () => {
    const without = loadEnv(infra('local'));
    const withIds = loadEnv(
      infra('local', {
        APPLE_BUNDLE_ID: 'org.example.fixture',
        APPLE_SERVICES_ID: 'org.example.fixture.web',
      }),
    );
    expect(withIds).toEqual(without);
    expect(Object.keys(withIds)).not.toContain('APPLE_BUNDLE_ID');
    expect(Object.keys(withIds)).not.toContain('APPLE_SERVICES_ID');
    // Not even a malformed value is read.
    expect(() => loadEnv(deployed('staging', { APPLE_BUNDLE_ID: 'bad id' }))).not.toThrow();
  });

  it('quotas', () => {
    expect(loadEnv(infra('ci', { EMAIL_DAILY_QUOTA: '0' })).EMAIL_DAILY_QUOTA).toBe(0);
    expect(loadEnv(infra('ci', { EMAIL_MONTHLY_QUOTA: '50000' })).EMAIL_MONTHLY_QUOTA).toBe(50_000);
    expect(loadEnv(infra('ci', { EMAIL_MONTHLY_QUOTA: '10000000' })).EMAIL_MONTHLY_QUOTA).toBe(
      10_000_000,
    );
    for (const variable of ['EMAIL_MONTHLY_QUOTA', 'EMAIL_DAILY_QUOTA']) {
      for (const value of ['-1', '1.5', '10000001', 'x']) {
        expect(refusal(infra('ci', { [variable]: value })).variables).toEqual([variable]);
      }
    }
  });

  it('geocoding caps', () => {
    const unset = loadEnv(infra('ci'));
    expect([unset.GEO_MONTHLY_CAP, unset.GEO_DAILY_CAP]).toEqual([85_000, 2_800]);
    const set = loadEnv(infra('ci', { GEO_MONTHLY_CAP: '50000', GEO_DAILY_CAP: '200' }));
    expect([set.GEO_MONTHLY_CAP, set.GEO_DAILY_CAP]).toEqual([50_000, 200]);
    for (const variable of ['GEO_MONTHLY_CAP', 'GEO_DAILY_CAP']) {
      for (const value of ['0', '-1', '1.5', 'x', '10000001']) {
        expect(refusal(infra('ci', { [variable]: value })).variables).toEqual([variable]);
      }
    }
  });

  it('a deployed service needs its required inputs', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      const env = loadEnv(deployed(appEnv));
      expect(env.RESEND_API_KEY).toBe(FIXTURE_KEY);
      expect(env.EMAIL_FROM).toBe(FIXTURE_FROM);
      expect(env.ADMIN_EMAILS).toEqual(['admin@example.test']);
      // The Apple variables may be unset on a deployed worker (D-557).
      expect(missingOwnerInputs(env)).toEqual(APPLE_OWNER_INPUTS);
      for (const name of ['RESEND_API_KEY', 'EMAIL_FROM', 'ADMIN_EMAILS']) {
        expect(refusal(deployed(appEnv, { [name]: undefined })).variables).toEqual([name]);
      }
    }
  });

  it('the key and the sender go together', () => {
    expect(refusal(infra('local', { RESEND_API_KEY: FIXTURE_KEY })).variables).toEqual([
      'EMAIL_FROM',
      'RESEND_API_KEY',
    ]);
    expect(refusal(infra('local', { EMAIL_FROM: FIXTURE_FROM })).variables).toEqual([
      'EMAIL_FROM',
      'RESEND_API_KEY',
    ]);
  });

  it('backups settings are required everywhere', () => {
    expect(refusal(infra('local', { BACKUPS_BUCKET: undefined })).variables).toEqual([
      'BACKUPS_BUCKET',
    ]);
    expect(refusal(deployed('staging', { BACKUPS_ACCESS_KEY_ID: undefined })).variables).toEqual([
      'BACKUPS_ACCESS_KEY_ID',
    ]);
    expect(
      refusal(infra('ci', { BACKUPS_ENDPOINT: 'ftp://store.example.test' })).variables,
    ).toEqual(['BACKUPS_ENDPOINT']);
  });

  it('a malformed secret is reported by name without its value', () => {
    const value = marker();
    const cases: { source: Source; variable: string }[] = [
      { source: infra('local', { DATABASE_URL: `nope-${value}` }), variable: 'DATABASE_URL' },
      {
        source: deployed('staging', { RESEND_API_KEY: `bad-${value}` }),
        variable: 'RESEND_API_KEY',
      },
    ];
    for (const { source, variable } of cases) {
      const error = refusal(source);
      expect(error.variables).toEqual([variable]);
      expect(String(error)).not.toContain(value);
      expect(error.message).not.toContain(value);
      expect(JSON.stringify(error)).not.toContain(value);
      expect(String(error.stack)).not.toContain(value);
    }
  });

  it('a malformed owner value in local is treated as unset', () => {
    const env = loadEnv(infra('local', { ADMIN_EMAILS: 'not-an-email' }));
    expect(env.ADMIN_EMAILS).toBeNull();
    expect(env.ownerInputReport.invalid).toEqual([
      { variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' },
    ]);
    const log = captured();
    logMissingOwnerInputs(env, log.logger);
    const invalid = log.lines.filter((line) => line.event === 'env.input_invalid');
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({
      level: 'warn',
      variable: 'ADMIN_EMAILS',
      ownerInput: 'OI-admin-emails',
    });
    expect(
      log.lines.some(
        (line) => line.event === 'env.input_missing' && line.variable === 'ADMIN_EMAILS',
      ),
    ).toBe(false);
    expect(log.raw.join('\n')).not.toContain('not-an-email');

    const value = marker();
    const pair = loadEnv(
      infra('local', { RESEND_API_KEY: `bad-${value}`, EMAIL_FROM: FIXTURE_FROM }),
    );
    expect(pair.RESEND_API_KEY).toBeNull();
    expect(pair.EMAIL_FROM).toBeNull();
    expect(pair.captureMail).toBe(true);
    const pairLog = captured();
    logMissingOwnerInputs(pair, pairLog.logger);
    expect(
      pairLog.lines
        .filter((line) => line.event === 'env.input_invalid')
        .map((line) => line.variable),
    ).toEqual(['RESEND_API_KEY']);
    expect(pairLog.raw.join('\n')).not.toContain(value);
  });

  it('the commit is optional and hex', () => {
    expect(loadEnv(infra('local')).RAILWAY_GIT_COMMIT_SHA).toBeNull();
    expect(
      loadEnv(infra('local', { RAILWAY_GIT_COMMIT_SHA: 'abc1234' })).RAILWAY_GIT_COMMIT_SHA,
    ).toBe('abc1234');
    expect(refusal(infra('local', { RAILWAY_GIT_COMMIT_SHA: 'xyz' })).variables).toEqual([
      'RAILWAY_GIT_COMMIT_SHA',
    ]);
  });

  it('envLabel equals APP_ENV', () => {
    for (const appEnv of ['local', 'ci'] as const) {
      expect(loadEnv(infra(appEnv)).envLabel).toBe(appEnv);
    }
    for (const appEnv of ['staging', 'production'] as const) {
      expect(loadEnv(deployed(appEnv)).envLabel).toBe(appEnv);
    }
  });

  it('captureMail follows the key', () => {
    expect(loadEnv(infra('local')).captureMail).toBe(true);
    expect(
      loadEnv(infra('local', { RESEND_API_KEY: FIXTURE_KEY, EMAIL_FROM: FIXTURE_FROM }))
        .captureMail,
    ).toBe(false);
    expect(loadEnv(deployed('staging')).captureMail).toBe(false);
  });

  it('defaults the log level and the path style, and ignores unknown and later variables', () => {
    const env = loadEnv(
      infra('local', { LEGAL_BUCKET: 'legal', MEDIA_BUCKET: 'media', SOMETHING_ELSE: 'x' }),
    );
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(Object.keys(env)).not.toContain('LEGAL_BUCKET');
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('an empty string counts as unset', () => {
    const env = loadEnv(infra('local', { RESEND_API_KEY: '', EMAIL_FROM: '' }));
    expect(env.RESEND_API_KEY).toBeNull();
    expect(env.EMAIL_FROM).toBeNull();
    expect(refusal(infra('local', { DATABASE_URL: '' })).variables).toEqual(['DATABASE_URL']);
  });

  it('the public URL is an origin', () => {
    for (const value of ['https://app.example.test/', 'https://app.example.test/x']) {
      expect(refusal(infra('local', { PUBLIC_URL: value })).variables).toEqual(['PUBLIC_URL']);
    }
  });

  it('admin addresses are normalised', () => {
    const env = loadEnv(infra('local', { ADMIN_EMAILS: ' Admin@Example.test , b@example.test ' }));
    expect(env.ADMIN_EMAILS).toEqual(['admin@example.test', 'b@example.test']);
    expect(refusal(deployed('staging', { ADMIN_EMAILS: 'not-an-email' })).variables).toEqual([
      'ADMIN_EMAILS',
    ]);
  });

  it('a missing APP_ENV is named alone', () => {
    expect(refusal(infra('local', { APP_ENV: undefined })).variables).toEqual(['APP_ENV']);
  });
  it('RESEND_DEBUG stops the process by name', () => {
    const value = marker();
    for (const source of [
      infra('local', { RESEND_DEBUG: '1' }),
      infra('ci', { RESEND_DEBUG: '1' }),
      deployed('staging', { RESEND_DEBUG: '1' }),
      deployed('production', { RESEND_DEBUG: 'true' }),
      infra('local', { RESEND_DEBUG: value }),
      infra('local', { RESEND_DEBUG: '' }),
    ]) {
      const error = refusal(source);
      expect(error.variables).toEqual(['RESEND_DEBUG']);
      expect(error.message).toContain('RESEND_DEBUG');
      expect(error.message).not.toContain(value);
      expect(JSON.stringify(error)).not.toContain(value);
    }
    expect(() => loadEnv(infra('local'))).not.toThrow();
  });

  it('a deployed service needs an https PUBLIC_URL', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      expect(
        refusal(deployed(appEnv, { PUBLIC_URL: 'http://app.example.test' })).variables,
      ).toEqual(['PUBLIC_URL']);
      expect(loadEnv(deployed(appEnv)).PUBLIC_URL).toBe('https://app.example.test');
    }
    for (const appEnv of ['local', 'ci'] as const) {
      expect(loadEnv(infra(appEnv, { PUBLIC_URL: 'http://localhost:8081' })).PUBLIC_URL).toBe(
        'http://localhost:8081',
      );
    }
  });
});
