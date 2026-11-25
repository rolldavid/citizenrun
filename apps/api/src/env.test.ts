import { EnvError, brandVariant, createLogger, variantForAppEnv } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { checkPublicUrlHost, loadEnv, logMissingOwnerInputs, missingOwnerInputs } from './env.ts';
import type { ApiEnv } from './env.ts';
import { testPublicUrl } from './testing/env.ts';

const DEFAULT_WEB_DIST_DIR = '/srv/fixture/web/dist';
const FIXTURE_KEY = 're_fixture_0000000000';
const FIXTURE_FROM = 'Fixture <alerts@mail.example.test>';
const FIXTURE_ADMINS = 'admin@example.test';
// The origin of a test environment whose brand variant has no host.
const FIXTURE_PUBLIC_URL = 'https://app.example.test';

type Source = Record<string, string | undefined>;

function infra(appEnv: string, extra: Source = {}): Source {
  return {
    NODE_ENV: 'test',
    APP_ENV: appEnv,
    PORT: '8080',
    DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/fixture',
    PUBLIC_URL: FIXTURE_PUBLIC_URL,
    MEDIA_BUCKET: 'media',
    MEDIA_ENDPOINT: 'http://localhost:8333',
    MEDIA_REGION: 'us-east-1',
    MEDIA_ACCESS_KEY_ID: 'fixture-access',
    MEDIA_SECRET_ACCESS_KEY: 'fixture-secret',
    ...extra,
  };
}

// A deployed environment serves at its variant's host once brand.json holds one.
function deployed(appEnv: 'staging' | 'production', extra: Source = {}): Source {
  return infra(appEnv, {
    PUBLIC_URL: testPublicUrl(appEnv),
    RESEND_API_KEY: FIXTURE_KEY,
    EMAIL_FROM: FIXTURE_FROM,
    ADMIN_EMAILS: FIXTURE_ADMINS,
    ...extra,
  });
}

function load(source: Source): ApiEnv {
  return loadEnv({ defaultWebDistDir: DEFAULT_WEB_DIST_DIR }, source);
}

function refusal(source: Source): EnvError {
  try {
    load(source);
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
    service: 'api',
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
      const env = load(infra(appEnv));
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
      for (const line of log.lines) {
        expect(line.level).toBe('warn');
        expect(line.event).toBe('env.input_missing');
        expect(Object.keys(line).sort()).toEqual([...LOGGER_KEYS, 'ownerInput', 'variable'].sort());
      }
      expect(log.lines.map((line) => [line.variable, line.ownerInput])).toEqual([
        ['RESEND_API_KEY', 'OI-resend'],
        ['EMAIL_FROM', 'OI-resend'],
        ['ADMIN_EMAILS', 'OI-admin-emails'],
      ]);
    }
  });

  it('a deployed service needs its required inputs', () => {
    const env = load(deployed('staging'));
    expect(env.RESEND_API_KEY).toBe(FIXTURE_KEY);
    expect(env.EMAIL_FROM).toBe(FIXTURE_FROM);
    expect(env.ADMIN_EMAILS).toEqual([FIXTURE_ADMINS]);
    expect(missingOwnerInputs(env)).toEqual([]);
    expect(env.ownerInputReport.invalid).toEqual([]);
    for (const variable of ['RESEND_API_KEY', 'EMAIL_FROM', 'ADMIN_EMAILS']) {
      expect(refusal(deployed('staging', { [variable]: undefined })).variables).toEqual([variable]);
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

  it('the pairing refusal reads only whether each is set', () => {
    // A malformed key without a sender is still the pairing refusal, not an unset value.
    expect(refusal(infra('ci', { RESEND_API_KEY: 'not-a-key' })).variables).toEqual([
      'EMAIL_FROM',
      'RESEND_API_KEY',
    ]);
  });

  it('captureMail follows the key', () => {
    expect(load(infra('local')).captureMail).toBe(true);
    const configured = load(
      infra('local', { RESEND_API_KEY: FIXTURE_KEY, EMAIL_FROM: FIXTURE_FROM }),
    );
    expect(configured.captureMail).toBe(false);
    expect(configured.RESEND_API_KEY).toBe(FIXTURE_KEY);
    expect(configured.EMAIL_FROM).toBe(FIXTURE_FROM);
    expect(missingOwnerInputs(configured)).toEqual([
      { variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' },
    ]);
    expect(load(deployed('staging')).captureMail).toBe(false);
  });

  it('no AI or LEGAL variable is accepted', () => {
    for (const [name, value] of [
      ['LEGAL_BUCKET', 'x'],
      ['LEGAL_ACCESS_KEY_ID', 'x'],
      ['ANTHROPIC_API_KEY', 'x'],
      ['AI_BUDGET_USD', '8'],
    ] as const) {
      expect(refusal(infra('local', { [name]: value })).variables).toEqual([name]);
    }
    // Other unknown variables are ignored.
    expect(() =>
      load(infra('local', { GEO_PROVIDER: 'none', APP_SECRET: '0'.repeat(64) })),
    ).not.toThrow();
  });

  it('dev routes never run in production', () => {
    expect(refusal(deployed('production', { ENABLE_DEV_ROUTES: 'true' })).variables).toEqual([
      'ENABLE_DEV_ROUTES',
    ]);
    const env = load(deployed('production', { ENABLE_DEV_ROUTES: 'false' }));
    expect(env.ENABLE_DEV_ROUTES).toBe(false);
    expect(env.devRoutes).toBe(false);
    expect(load(infra('local', { ENABLE_DEV_ROUTES: 'true' })).devRoutes).toBe(true);
  });

  it('a malformed secret is reported by name without its value', () => {
    const value = marker();
    const cases: [Source, string][] = [
      [infra('local', { DATABASE_URL: `nope-${value}` }), 'DATABASE_URL'],
      [deployed('staging', { RESEND_API_KEY: `bad-${value}` }), 'RESEND_API_KEY'],
    ];
    for (const [source, variable] of cases) {
      const error = refusal(source);
      expect(error.variables).toEqual([variable]);
      expect(String(error)).not.toContain(value);
      expect(error.message).not.toContain(value);
      expect(error.message).toContain(variable);
      expect(JSON.stringify(error)).not.toContain(value);
      expect(error.cause).toBeUndefined();
    }
  });

  it('a malformed owner value in local is treated as unset', () => {
    const admins = load(infra('local', { ADMIN_EMAILS: 'not-an-email' }));
    expect(admins.ADMIN_EMAILS).toBeNull();
    expect(admins.ownerInputReport.invalid).toEqual([
      { variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' },
    ]);
    const adminLog = captured();
    logMissingOwnerInputs(admins, adminLog.logger);
    const invalidLines = adminLog.lines.filter((line) => line.event === 'env.input_invalid');
    expect(invalidLines).toHaveLength(1);
    expect(invalidLines[0]).toMatchObject({
      level: 'warn',
      variable: 'ADMIN_EMAILS',
      ownerInput: 'OI-admin-emails',
    });
    expect(
      adminLog.lines.filter(
        (line) => line.event === 'env.input_missing' && line.variable === 'ADMIN_EMAILS',
      ),
    ).toEqual([]);
    expect(adminLog.raw.join('\n')).not.toContain('not-an-email');

    const value = marker();
    const pair = load(infra('local', { RESEND_API_KEY: `bad-${value}`, EMAIL_FROM: FIXTURE_FROM }));
    expect(pair.RESEND_API_KEY).toBeNull();
    expect(pair.EMAIL_FROM).toBeNull();
    expect(pair.captureMail).toBe(true);
    expect(pair.ownerInputReport.invalid).toEqual([
      { variable: 'RESEND_API_KEY', ownerInput: 'OI-resend' },
    ]);
    // The well-formed partner is in neither list.
    expect(pair.ownerInputReport.missing).toEqual([
      { variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' },
    ]);
    const pairLog = captured();
    logMissingOwnerInputs(pair, pairLog.logger);
    const pairInvalid = pairLog.lines.filter((line) => line.event === 'env.input_invalid');
    expect(pairInvalid).toHaveLength(1);
    expect(pairInvalid[0]?.variable).toBe('RESEND_API_KEY');
    expect(pairLog.raw.join('\n')).not.toContain(value);
  });

  it('a malformed owner value stops a deployed service', () => {
    expect(refusal(deployed('production', { EMAIL_FROM: 'no address here' })).variables).toEqual([
      'EMAIL_FROM',
    ]);
  });

  it('derived values follow APP_ENV', () => {
    const envs = {
      local: load(infra('local')),
      ci: load(infra('ci')),
      staging: load(deployed('staging')),
      production: load(deployed('production')),
    };
    expect(Object.values(envs).map((env) => env.isIndexable)).toEqual([false, false, false, true]);
    expect(Object.values(envs).map((env) => env.mapUrlsFromRequestOrigin)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(Object.values(envs).map((env) => env.redirectHttp)).toEqual([false, false, true, true]);
    expect(Object.values(envs).map((env) => env.variant)).toEqual([
      'development',
      'development',
      'staging',
      'production',
    ]);
  });

  it('strict responses only under the test runtime', () => {
    expect(
      ['test', 'development', 'production'].map(
        (nodeEnv) => load(infra('ci', { NODE_ENV: nodeEnv })).strictResponses,
      ),
    ).toEqual([true, false, false]);
    expect(load(deployed('production', { NODE_ENV: 'test' })).strictResponses).toBe(true);
  });

  it('minimum versions default and refuse a bad form', () => {
    const env = load(infra('local'));
    expect(env.MIN_CLIENT_VERSION_IOS).toBe('0.0.0');
    expect(env.MIN_CLIENT_VERSION_ANDROID).toBe('0.0.0');
    expect(env.MIN_CLIENT_VERSION_WEB).toBe('0.0.0');
    expect(refusal(infra('local', { MIN_CLIENT_VERSION_IOS: '1.4' })).variables).toEqual([
      'MIN_CLIENT_VERSION_IOS',
    ]);
  });

  it('admin addresses are normalised and validated', () => {
    expect(
      load(infra('local', { ADMIN_EMAILS: ' Admin@Example.test , b@example.test ' })).ADMIN_EMAILS,
    ).toEqual(['admin@example.test', 'b@example.test']);
    const error = refusal(deployed('staging', { ADMIN_EMAILS: 'not-an-email' }));
    expect(error.variables).toEqual(['ADMIN_EMAILS']);
    expect(String(error)).not.toContain('not-an-email');
    expect(JSON.stringify(error)).not.toContain('not-an-email');
  });

  it('more than 50 admin addresses are malformed', () => {
    const many = Array.from({ length: 51 }, (_, index) => `a${String(index)}@example.test`).join(
      ',',
    );
    expect(load(infra('local', { ADMIN_EMAILS: many })).ownerInputReport.invalid).toEqual([
      { variable: 'ADMIN_EMAILS', ownerInput: 'OI-admin-emails' },
    ]);
    // A list of commas only is unset.
    expect(load(infra('local', { ADMIN_EMAILS: ' , ,' })).ownerInputReport.missing).toContainEqual({
      variable: 'ADMIN_EMAILS',
      ownerInput: 'OI-admin-emails',
    });
  });

  it('an empty string counts as unset', () => {
    const env = load(infra('local', { RESEND_API_KEY: '', EMAIL_FROM: '' }));
    expect(env.RESEND_API_KEY).toBeNull();
    expect(env.EMAIL_FROM).toBeNull();
    expect(env.captureMail).toBe(true);
    expect(refusal(infra('local', { DATABASE_URL: '' })).variables).toEqual(['DATABASE_URL']);
  });

  it('the public URL is an origin', () => {
    for (const publicUrl of ['https://app.example.test/', 'https://app.example.test/x']) {
      expect(refusal(infra('local', { PUBLIC_URL: publicUrl })).variables).toEqual(['PUBLIC_URL']);
    }
    expect(refusal(infra('local', { PUBLIC_URL: 'ftp://app.example.test' })).variables).toEqual([
      'PUBLIC_URL',
    ]);
    expect(load(infra('local', { PUBLIC_URL: 'http://localhost:8081' })).PUBLIC_URL).toBe(
      'http://localhost:8081',
    );
  });

  it('the public URL matches the variant host', () => {
    expect(checkPublicUrlHost('staging', 'https://a.example.test', 'b.example.test')).toBe(
      'PUBLIC_URL',
    );
    expect(checkPublicUrlHost('staging', 'https://a.example.test', null)).toBeNull();
    expect(checkPublicUrlHost('local', 'https://a.example.test', 'b.example.test')).toBeNull();
    expect(checkPublicUrlHost('production', 'https://b.example.test', 'b.example.test')).toBeNull();

    // loadEnv applies it with the committed brand: a host written there refuses any other.
    for (const appEnv of ['staging', 'production'] as const) {
      const other = deployed(appEnv, { PUBLIC_URL: FIXTURE_PUBLIC_URL });
      if (brandVariant(variantForAppEnv(appEnv)).host === null) {
        expect(load(other).PUBLIC_URL).toBe(FIXTURE_PUBLIC_URL);
      } else {
        expect(refusal(other).variables).toEqual(['PUBLIC_URL']);
      }
    }
  });

  it('the client address header is optional', () => {
    expect(load(infra('local')).CLIENT_IP_HEADER).toBeNull();
    expect(load(infra('local', { CLIENT_IP_HEADER: 'X-Real-IP' })).CLIENT_IP_HEADER).toBe(
      'x-real-ip',
    );
    expect(refusal(infra('local', { CLIENT_IP_HEADER: 'x real ip' })).variables).toEqual([
      'CLIENT_IP_HEADER',
    ]);
  });

  it('infrastructure values are parsed with their defaults', () => {
    const env = load(infra('local'));
    expect(env.PORT).toBe(8080);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.WEB_DIST_DIR).toBe(DEFAULT_WEB_DIST_DIR);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
    expect(Object.isFrozen(env)).toBe(true);
    expect(refusal(infra('local', { PORT: '70000' })).variables).toEqual(['PORT']);
    expect(refusal(infra('local', { WEB_DIST_DIR: 'relative/dist' })).variables).toEqual([
      'WEB_DIST_DIR',
    ]);
    expect(refusal(infra('local', { NODE_ENV: undefined, PORT: undefined })).variables).toEqual([
      'NODE_ENV',
      'PORT',
    ]);
    expect(refusal(infra('nowhere')).variables).toEqual(['APP_ENV']);
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
    expect(() => load(infra('local'))).not.toThrow();
  });

  it('a deployed service needs an https PUBLIC_URL', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      const origin = testPublicUrl(appEnv);
      const overHttp = origin.replace(/^https:/, 'http:');
      expect(new URL(overHttp).hostname).toBe(new URL(origin).hostname);
      expect(refusal(deployed(appEnv, { PUBLIC_URL: overHttp })).variables).toEqual(['PUBLIC_URL']);
      expect(load(deployed(appEnv)).PUBLIC_URL).toBe(origin);
    }
    for (const appEnv of ['local', 'ci'] as const) {
      expect(load(infra(appEnv, { PUBLIC_URL: 'http://localhost:8081' })).PUBLIC_URL).toBe(
        'http://localhost:8081',
      );
    }
  });
});
