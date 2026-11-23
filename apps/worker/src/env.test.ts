import { EnvError, createLogger } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { WORKER_OWNER_INPUTS, loadEnv, logMissingOwnerInputs, missingOwnerInputs } from './env.ts';

const FIXTURE_KEY = 're_fixture_0000000000';
const FIXTURE_FROM = 'Fixture <alerts@mail.example.test>';
const FIXTURE_ADMINS = 'admin@example.test';

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
      ]);
      const log = captured();
      logMissingOwnerInputs(env, log.logger);
      expect(log.lines).toHaveLength(3);
      expect(log.lines.map((line) => line.variable)).toEqual([
        'RESEND_API_KEY',
        'EMAIL_FROM',
        'ADMIN_EMAILS',
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
      ]);
    }
  });

  it('lists the three owner inputs in report order', () => {
    expect(WORKER_OWNER_INPUTS.map((row) => row.variable)).toEqual([
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'ADMIN_EMAILS',
    ]);
  });

  it('a deployed service needs its required inputs', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      const env = loadEnv(deployed(appEnv));
      expect(env.RESEND_API_KEY).toBe(FIXTURE_KEY);
      expect(env.EMAIL_FROM).toBe(FIXTURE_FROM);
      expect(env.ADMIN_EMAILS).toEqual(['admin@example.test']);
      expect(missingOwnerInputs(env)).toEqual([]);
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
