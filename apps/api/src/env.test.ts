import { generateKeyPairSync } from 'node:crypto';
import {
  BrandValueMissingError,
  EnvError,
  brandVariant,
  createLogger,
  variantForAppEnv,
} from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  API_OWNER_INPUTS,
  ApiEnvError,
  checkPublicUrlHost,
  checkReviewSignIn,
  loadEnv,
  logMissingOwnerInputs,
  missingOwnerInputs,
} from './env.ts';
import type { ApiEnv } from './env.ts';
import { testPublicUrl } from './testing/env.ts';

const DEFAULT_WEB_DIST_DIR = '/srv/fixture/web/dist';
const FIXTURE_KEY = 're_fixture_0000000000';
const FIXTURE_FROM = 'Fixture <alerts@mail.example.test>';
const FIXTURE_ADMINS = 'admin@example.test';
// The origin of a test environment whose brand variant has no host.
const FIXTURE_PUBLIC_URL = 'https://app.example.test';
// The local constant of the API's .env.example: never a real secret.
const LOCAL_APP_SECRET = '0'.repeat(64);
const FIXTURE_APPLE = {
  APPLE_TEAM_ID: 'FIXTURE001',
  APPLE_KEY_ID: 'FIXTURE002',
  APPLE_BUNDLE_ID: 'org.example.fixture',
  APPLE_SERVICES_ID: 'org.example.fixture.web',
} as const;
const APPLE_VARIABLES = [
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  'APPLE_BUNDLE_ID',
  'APPLE_SERVICES_ID',
] as const;
// Owner inputs a deployed service may run without (D-557), in report order.
const OPTIONAL_OWNER_INPUTS = [
  { variable: 'REVIEW_SIGNIN_EMAILS', ownerInput: 'OI-store-submission' },
  { variable: 'REVIEW_SIGNIN_CODE', ownerInput: 'OI-store-submission' },
  { variable: 'APPLE_TEAM_ID', ownerInput: 'OI-apple-identifiers' },
  { variable: 'APPLE_KEY_ID', ownerInput: 'OI-apple-identifiers' },
  { variable: 'APPLE_PRIVATE_KEY', ownerInput: 'OI-apple-identifiers' },
  { variable: 'APPLE_BUNDLE_ID', ownerInput: 'OI-apple-identifiers' },
  { variable: 'APPLE_SERVICES_ID', ownerInput: 'OI-apple-identifiers' },
  { variable: 'GOOGLE_CLIENT_IDS', ownerInput: 'OI-google-oauth' },
  { variable: 'GEO_API_KEY', ownerInput: 'OI-geoapify' },
];
// A fixture key, never a real one.
const FIXTURE_GEO_KEY = 'fixture-geo-key';
const MAPBOX_REASON = 'The mapbox provider is not available: set GEO_PROVIDER to geoapify or none';

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
    PORT: '8080',
    DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/fixture',
    PUBLIC_URL: FIXTURE_PUBLIC_URL,
    MEDIA_BUCKET: 'media',
    MEDIA_ENDPOINT: 'http://localhost:8333',
    MEDIA_REGION: 'us-east-1',
    MEDIA_ACCESS_KEY_ID: 'fixture-access',
    MEDIA_SECRET_ACCESS_KEY: 'fixture-secret',
    APP_SECRET: LOCAL_APP_SECRET,
    ...extra,
  };
}

// A deployed environment serves at its variant's host once brand.json holds one.
function deployed(appEnv: 'staging' | 'production', extra: Source = {}): Source {
  return infra(appEnv, {
    PUBLIC_URL: testPublicUrl(appEnv),
    CLIENT_IP_HEADER: 'x-real-ip',
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
      expect(missingOwnerInputs(env)).toEqual(API_OWNER_INPUTS);
      const log = captured();
      logMissingOwnerInputs(env, log.logger);
      expect(log.lines).toHaveLength(API_OWNER_INPUTS.length);
      for (const line of log.lines) {
        expect(line.level).toBe('warn');
        expect(line.event).toBe('env.input_missing');
        expect(Object.keys(line).sort()).toEqual([...LOGGER_KEYS, 'ownerInput', 'variable'].sort());
      }
      expect(log.lines.map((line) => [line.variable, line.ownerInput])).toEqual([
        ['RESEND_API_KEY', 'OI-resend'],
        ['EMAIL_FROM', 'OI-resend'],
        ['ADMIN_EMAILS', 'OI-admin-emails'],
        ...OPTIONAL_OWNER_INPUTS.map((row) => [row.variable, row.ownerInput]),
      ]);
    }
  });

  it('starts in local with no owner input', () => {
    // The local values of the API's .env.example without its one owner value, ADMIN_EMAILS.
    const env = load({
      NODE_ENV: 'development',
      APP_ENV: 'local',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgresql://citizenrun:citizenrun@localhost:5432/citizenrun',
      PUBLIC_URL: 'http://localhost:8081',
      ENABLE_DEV_ROUTES: 'true',
      MEDIA_BUCKET: 'media',
      MEDIA_ENDPOINT: 'http://localhost:8333',
      MEDIA_REGION: 'us-east-1',
      MEDIA_ACCESS_KEY_ID: 'osdev',
      MEDIA_SECRET_ACCESS_KEY: 'osdev-secret-key',
      S3_FORCE_PATH_STYLE: 'true',
      APP_SECRET: LOCAL_APP_SECRET,
      GEO_PROVIDER: 'none',
    });
    for (const variable of APPLE_VARIABLES) {
      expect(env[variable]).toBeNull();
    }
    expect(env.GOOGLE_CLIENT_IDS).toBeNull();
    expect(env.REVIEW_SIGNIN_EMAILS).toBeNull();
    expect(env.REVIEW_SIGNIN_CODE).toBeNull();
    expect(env.ADMIN_EMAILS).toBeNull();
    expect(env.CLIENT_IP_HEADER).toBeNull();
    expect(env.APP_SECRET_PREVIOUS).toBeNull();
    expect(env.captureMail).toBe(true);
    const log = captured();
    logMissingOwnerInputs(env, log.logger);
    expect(log.lines.map((line) => line.variable)).toEqual(
      API_OWNER_INPUTS.map((row) => row.variable),
    );
    for (const line of log.lines) {
      expect(line.event).toBe('env.input_missing');
      expect(Object.keys(line).sort()).toEqual([...LOGGER_KEYS, 'ownerInput', 'variable'].sort());
    }
  });

  it('stops without APP_SECRET in every environment', () => {
    for (const source of [
      infra('local', { APP_SECRET: undefined }),
      infra('ci', { APP_SECRET: undefined }),
      deployed('staging', { APP_SECRET: undefined }),
      deployed('production', { APP_SECRET: '' }),
    ]) {
      expect(refusal(source).variables).toEqual(['APP_SECRET']);
    }
  });

  it('refuses a malformed APP_SECRET', () => {
    for (const value of ['a'.repeat(63), `${'a'.repeat(63)}g`, 'a'.repeat(65)]) {
      for (const variable of ['APP_SECRET', 'APP_SECRET_PREVIOUS']) {
        const error = refusal(infra('local', { [variable]: value }));
        expect(error.variables).toEqual([variable]);
        expect(error.message).toContain(variable);
        expect(error.message).not.toContain(value);
        expect(JSON.stringify(error)).not.toContain(value);
      }
    }
  });

  it('stores the secret lower-case', () => {
    const upper = 'ABCDEF0123456789'.repeat(4);
    const env = load(infra('ci', { APP_SECRET: upper, APP_SECRET_PREVIOUS: upper }));
    expect(env.APP_SECRET).toBe(upper.toLowerCase());
    expect(env.APP_SECRET_PREVIOUS).toBe(upper.toLowerCase());
  });

  it('staging needs CLIENT_IP_HEADER', () => {
    for (const appEnv of ['staging', 'production'] as const) {
      expect(refusal(deployed(appEnv, { CLIENT_IP_HEADER: undefined })).variables).toEqual([
        'CLIENT_IP_HEADER',
      ]);
    }
    expect(load(deployed('staging')).CLIENT_IP_HEADER).toBe('x-real-ip');
    expect(load(infra('ci', { CLIENT_IP_HEADER: undefined })).CLIENT_IP_HEADER).toBeNull();
  });

  it('apple values', () => {
    const pem = fixturePem();
    const all = load(infra('local', { ...FIXTURE_APPLE, APPLE_PRIVATE_KEY: pem }));
    expect(all.APPLE_TEAM_ID).toBe('FIXTURE001');
    expect(all.APPLE_KEY_ID).toBe('FIXTURE002');
    expect(all.APPLE_PRIVATE_KEY).toBe(pem.trim());
    expect(all.APPLE_BUNDLE_ID).toBe('org.example.fixture');
    expect(all.APPLE_SERVICES_ID).toBe('org.example.fixture.web');
    expect(missingOwnerInputs(all).map((row) => row.variable)).not.toContain('APPLE_TEAM_ID');

    // Each field carries its own value: four set leave the fifth null and reported.
    for (const left of APPLE_VARIABLES) {
      const env = load(
        infra('local', { ...FIXTURE_APPLE, APPLE_PRIVATE_KEY: pem, [left]: undefined }),
      );
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

    // A key written with literal \n sequences, as in a .env file, gives the same key.
    const escaped = pem.trim().replaceAll('\n', '\\n');
    expect(escaped).not.toContain('\n');
    expect(load(infra('local', { APPLE_PRIVATE_KEY: escaped })).APPLE_PRIVATE_KEY).toBe(pem.trim());

    // A key that is not a PKCS#8 PEM is malformed.
    const ec = pem.replace('BEGIN PRIVATE KEY', 'BEGIN EC PRIVATE KEY');
    expect(load(infra('ci', { APPLE_PRIVATE_KEY: ec })).ownerInputReport.invalid).toEqual([
      { variable: 'APPLE_PRIVATE_KEY', ownerInput: 'OI-apple-identifiers' },
    ]);
    expect(load(infra('ci', { APPLE_TEAM_ID: 'fixture001' })).APPLE_TEAM_ID).toBeNull();
    expect(
      load(infra('ci', { APPLE_BUNDLE_ID: 'org.example/fixture' })).APPLE_BUNDLE_ID,
    ).toBeNull();
  });

  it('google ids', () => {
    const raw = ' a.apps.googleusercontent.com , ,b.apps.googleusercontent.com ';
    const env = load(infra('local', { GOOGLE_CLIENT_IDS: raw }));
    expect(env.GOOGLE_CLIENT_IDS).toBe(raw);
    expect(env.ownerInputReport.invalid).toEqual([]);
    expect(load(infra('local', { GOOGLE_CLIENT_IDS: '' })).GOOGLE_CLIENT_IDS).toBeNull();
    const commas = load(infra('local', { GOOGLE_CLIENT_IDS: ' , ' }));
    expect(commas.GOOGLE_CLIENT_IDS).toBeNull();
    expect(missingOwnerInputs(commas)).toContainEqual({
      variable: 'GOOGLE_CLIENT_IDS',
      ownerInput: 'OI-google-oauth',
    });
  });

  it('admin emails', () => {
    expect(
      load(infra('local', { ADMIN_EMAILS: 'Admin@Example.Test, other@example.test' })).ADMIN_EMAILS,
    ).toEqual(['admin@example.test', 'other@example.test']);
  });

  it('review sign-in needs a six-digit code', () => {
    const emails = 'review@example.test';
    for (const code of ['12345', undefined, '1234567', 'abcdef']) {
      const error = refusal(
        infra('local', { REVIEW_SIGNIN_EMAILS: emails, REVIEW_SIGNIN_CODE: code }),
      );
      expect(error.variables).toEqual(['REVIEW_SIGNIN_CODE', 'REVIEW_SIGNIN_EMAILS']);
      if (code !== undefined) {
        expect(error.message).not.toContain(code);
      }
    }
    const env = load(
      infra('local', { REVIEW_SIGNIN_EMAILS: emails, REVIEW_SIGNIN_CODE: '123456' }),
    );
    expect(env.REVIEW_SIGNIN_EMAILS).toBe(emails);
    expect(env.REVIEW_SIGNIN_CODE).toBe('123456');
    // The code alone turns nothing on and stops nothing.
    expect(load(infra('local', { REVIEW_SIGNIN_CODE: '123456' })).REVIEW_SIGNIN_EMAILS).toBeNull();
  });

  it('a review address in ADMIN_EMAILS stops the API', () => {
    const error = refusal(
      infra('ci', {
        ADMIN_EMAILS: 'admin@example.test',
        REVIEW_SIGNIN_EMAILS: 'perf_01@example.test, Admin@Example.Test',
        REVIEW_SIGNIN_CODE: '123456',
      }),
    );
    expect(error.variables).toEqual(['ADMIN_EMAILS', 'REVIEW_SIGNIN_EMAILS']);
    expect(error.message).not.toContain('admin@example.test');
    const apart = load(
      infra('ci', {
        ADMIN_EMAILS: 'admin@example.test',
        REVIEW_SIGNIN_EMAILS: 'perf_01@example.test',
        REVIEW_SIGNIN_CODE: '123456',
      }),
    );
    expect(apart.REVIEW_SIGNIN_EMAILS).toBe('perf_01@example.test');
  });

  it('with APP_ENV=production an @example.test review address stops the API, with APP_ENV=staging it is accepted', () => {
    const review = { REVIEW_SIGNIN_EMAILS: 'perf_01@example.test', REVIEW_SIGNIN_CODE: '123456' };
    expect(refusal(deployed('production', review)).variables).toEqual(['REVIEW_SIGNIN_EMAILS']);
    expect(load(deployed('staging', review)).REVIEW_SIGNIN_EMAILS).toBe('perf_01@example.test');
  });

  it('the production mail-host check compares the host part lower-case', () => {
    const base = {
      reviewEmailsSet: true,
      reviewCode: '123456',
      adminEmails: null,
      mailHostOf: () => 'Mail.Example.Test',
    } as const;
    expect(
      checkReviewSignIn({
        ...base,
        appEnv: 'production',
        reviewAddresses: ['review@mail.example.test'],
      }),
    ).toEqual([]);
    expect(
      checkReviewSignIn({
        ...base,
        appEnv: 'production',
        reviewAddresses: ['review@mail.example.test', 'perf_01@example.test'],
      }),
    ).toEqual(['REVIEW_SIGNIN_EMAILS']);
    expect(
      checkReviewSignIn({ ...base, appEnv: 'staging', reviewAddresses: ['perf_01@example.test'] }),
    ).toEqual([]);
    // With no domain in the brand there is no mail host, so every review address fails.
    expect(
      checkReviewSignIn({
        ...base,
        appEnv: 'production',
        reviewAddresses: ['review@mail.example.test'],
        mailHostOf: () => {
          throw new BrandValueMissingError('domain', 'OI-domain');
        },
      }),
    ).toEqual(['REVIEW_SIGNIN_EMAILS', 'OI-domain']);
  });

  it('cookie name follows PUBLIC_URL', () => {
    const https = load(infra('ci', { PUBLIC_URL: 'https://app.example.test' }));
    expect(https.SESSION_COOKIE_NAME).toBe('__Host-os_session');
    expect(https.sessionCookieSecure).toBe(true);
    const http = load(infra('local', { PUBLIC_URL: 'http://localhost:8081' }));
    expect(http.SESSION_COOKIE_NAME).toBe('os_session');
    expect(http.sessionCookieSecure).toBe(false);
  });

  it('refuses LEGAL_ variables', () => {
    for (const source of [
      infra('local', { LEGAL_BUCKET: 'x' }),
      infra('ci', { LEGAL_BUCKET: 'x' }),
      deployed('staging', { LEGAL_BUCKET: 'x' }),
      deployed('production', { LEGAL_BUCKET: 'x' }),
    ]) {
      expect(refusal(source).variables).toEqual(['LEGAL_BUCKET']);
    }
  });

  it('never logs a value', () => {
    const value = marker();
    const source = infra('local', {
      RESEND_API_KEY: `re_${value}`,
      EMAIL_FROM: `bad ${value}`,
      ADMIN_EMAILS: value,
      REVIEW_SIGNIN_CODE: value,
      APPLE_TEAM_ID: value,
      APPLE_KEY_ID: value,
      APPLE_PRIVATE_KEY: value,
      APPLE_BUNDLE_ID: `${value}/x`,
      APPLE_SERVICES_ID: `${value}/x`,
      GOOGLE_CLIENT_IDS: `${value} x`,
      APP_SECRET_PREVIOUS: undefined,
    });
    const env = load(source);
    const log = captured();
    logMissingOwnerInputs(env, log.logger);
    expect(log.lines.length).toBeGreaterThan(0);
    expect(log.raw.join('\n')).not.toContain(value);
    for (const line of log.lines) {
      expect(Object.keys(line).sort()).toEqual([...LOGGER_KEYS, 'ownerInput', 'variable'].sort());
    }
    // A refused value is named, never shown.
    const error = refusal(infra('local', { APP_SECRET: value, REVIEW_SIGNIN_EMAILS: value }));
    expect(JSON.stringify(error)).not.toContain(value);
    expect(error.message).not.toContain(value);
  });

  it('a deployed service needs its required inputs', () => {
    const env = load(deployed('staging'));
    expect(env.RESEND_API_KEY).toBe(FIXTURE_KEY);
    expect(env.EMAIL_FROM).toBe(FIXTURE_FROM);
    expect(env.ADMIN_EMAILS).toEqual([FIXTURE_ADMINS]);
    // The five Apple variables, the Google ids and the review sign-in may be unset (D-557).
    for (const variable of APPLE_VARIABLES) {
      expect(env[variable]).toBeNull();
    }
    expect(env.GOOGLE_CLIENT_IDS).toBeNull();
    expect(missingOwnerInputs(env)).toEqual(OPTIONAL_OWNER_INPUTS);
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
      ...OPTIONAL_OWNER_INPUTS,
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
      ...OPTIONAL_OWNER_INPUTS,
    ]);
    const pairLog = captured();
    logMissingOwnerInputs(pair, pairLog.logger);
    const pairInvalid = pairLog.lines.filter((line) => line.event === 'env.input_invalid');
    expect(pairInvalid).toHaveLength(1);
    expect(pairInvalid[0]?.variable).toBe('RESEND_API_KEY');
    expect(pairLog.raw.join('\n')).not.toContain(value);

    const google = load(infra('local', { GOOGLE_CLIENT_IDS: 'bad id with spaces' }));
    expect(google.GOOGLE_CLIENT_IDS).toBeNull();
    const googleLog = captured();
    logMissingOwnerInputs(google, googleLog.logger);
    expect(googleLog.lines.filter((line) => line.event === 'env.input_invalid')).toEqual([
      expect.objectContaining({
        level: 'warn',
        variable: 'GOOGLE_CLIENT_IDS',
        ownerInput: 'OI-google-oauth',
      }),
    ]);
    expect(googleLog.raw.join('\n')).not.toContain('bad id');
    const error = refusal(deployed('staging', { GOOGLE_CLIENT_IDS: 'bad id with spaces' }));
    expect(error.variables).toEqual(['GOOGLE_CLIENT_IDS']);
    expect(error.message).not.toContain('bad id');
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

  it('the review list admits the perf and load accounts and refuses more than 100 addresses', () => {
    // The stand-in's and staging's list: perf_01 and load_01 to load_50, 51 addresses.
    const loadAccounts = Array.from(
      { length: 50 },
      (_, index) => `load_${String(index + 1).padStart(2, '0')}@example.test`,
    );
    const measurement = ['perf_01@example.test', ...loadAccounts].join(',');
    const local = load(
      infra('local', { REVIEW_SIGNIN_EMAILS: measurement, REVIEW_SIGNIN_CODE: '012345' }),
    );
    expect(local.REVIEW_SIGNIN_EMAILS).toBe(measurement);
    expect(local.ownerInputReport.invalid).toEqual([]);
    const staging = load(
      deployed('staging', { REVIEW_SIGNIN_EMAILS: measurement, REVIEW_SIGNIN_CODE: '012345' }),
    );
    expect(staging.REVIEW_SIGNIN_EMAILS).toBe(measurement);

    const tooMany = Array.from(
      { length: 101 },
      (_, index) => `r${String(index)}@example.test`,
    ).join(',');
    const refused = load(
      infra('local', { REVIEW_SIGNIN_EMAILS: tooMany, REVIEW_SIGNIN_CODE: '012345' }),
    );
    expect(refused.REVIEW_SIGNIN_EMAILS).toBeNull();
    expect(refused.ownerInputReport.invalid).toEqual([
      { variable: 'REVIEW_SIGNIN_EMAILS', ownerInput: 'OI-store-submission' },
    ]);
    expect(
      refusal(deployed('staging', { REVIEW_SIGNIN_EMAILS: tooMany, REVIEW_SIGNIN_CODE: '012345' }))
        .variables,
    ).toEqual(['REVIEW_SIGNIN_EMAILS']);
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

describe('geocoding environment', () => {
  it('the provider defaults to none', () => {
    for (const source of [infra('local'), infra('ci', { GEO_PROVIDER: '' }), deployed('staging')]) {
      const env = load(source);
      expect(env.GEO_PROVIDER).toBe('none');
      expect(env.geoProvider).toBe('none');
      expect(env.GEO_API_KEY).toBeNull();
    }
    // A key alone turns nothing on.
    const keyOnly = load(infra('ci', { GEO_API_KEY: FIXTURE_GEO_KEY }));
    expect(keyOnly.GEO_API_KEY).toBe(FIXTURE_GEO_KEY);
    expect(keyOnly.geoProvider).toBe('none');
    expect(load(infra('ci', { GEO_PROVIDER: 'none' })).geoProvider).toBe('none');
  });

  it('geoapify without a key runs as none', () => {
    for (const source of [
      infra('local', { GEO_PROVIDER: 'geoapify' }),
      infra('ci', { GEO_PROVIDER: 'geoapify', GEO_API_KEY: '' }),
      deployed('staging', { GEO_PROVIDER: 'geoapify' }),
      deployed('production', { GEO_PROVIDER: 'geoapify' }),
    ]) {
      const env = load(source);
      expect(env.GEO_PROVIDER).toBe('geoapify');
      expect(env.geoProvider).toBe('none');
      expect(missingOwnerInputs(env)).toContainEqual({
        variable: 'GEO_API_KEY',
        ownerInput: 'OI-geoapify',
      });
      const log = captured();
      logMissingOwnerInputs(env, log.logger);
      const geo = log.lines.filter((line) => line.variable === 'GEO_API_KEY');
      expect(geo).toHaveLength(1);
      expect(geo[0]?.event).toBe('env.input_missing');
      expect(geo[0]?.ownerInput).toBe('OI-geoapify');
      expect(Object.keys(geo[0] ?? {}).sort()).toEqual(
        [...LOGGER_KEYS, 'ownerInput', 'variable'].sort(),
      );
    }
  });

  it('geoapify with a key runs as geoapify', () => {
    const key = `${marker()}-geo-key`;
    for (const source of [
      infra('local', { GEO_PROVIDER: 'geoapify', GEO_API_KEY: key }),
      deployed('production', { GEO_PROVIDER: 'geoapify', GEO_API_KEY: key }),
    ]) {
      const env = load(source);
      expect(env.geoProvider).toBe('geoapify');
      expect(env.GEO_API_KEY).toBe(key);
      expect(missingOwnerInputs(env).map((row) => row.variable)).not.toContain('GEO_API_KEY');
      const log = captured();
      logMissingOwnerInputs(env, log.logger);
      expect(log.raw.join('\n')).not.toContain(key);
    }
  });

  it('a malformed key is unset in ci and stops a deployed service', () => {
    const spaced = 'fixture geo key';
    const env = load(infra('ci', { GEO_PROVIDER: 'geoapify', GEO_API_KEY: spaced }));
    expect(env.GEO_API_KEY).toBeNull();
    expect(env.geoProvider).toBe('none');
    expect(env.ownerInputReport.invalid).toEqual([
      { variable: 'GEO_API_KEY', ownerInput: 'OI-geoapify' },
    ]);
    const error = refusal(deployed('staging', { GEO_API_KEY: spaced }));
    expect(error.variables).toEqual(['GEO_API_KEY']);
    expect(error.message).not.toContain(spaced);
    expect(load(infra('ci', { GEO_API_KEY: 'k'.repeat(257) })).GEO_API_KEY).toBeNull();
  });

  it('mapbox stops the start', () => {
    for (const source of [
      infra('local', { GEO_PROVIDER: 'mapbox' }),
      infra('ci', { GEO_PROVIDER: 'mapbox', GEO_API_KEY: FIXTURE_GEO_KEY }),
      deployed('production', { GEO_PROVIDER: 'mapbox', GEO_API_KEY: FIXTURE_GEO_KEY }),
    ]) {
      const error = refusal(source);
      expect(error.variables).toEqual(['GEO_PROVIDER']);
      expect(error.message).toContain('GEO_PROVIDER');
      expect(error.message).toContain(MAPBOX_REASON);
      expect(error.message).not.toContain(FIXTURE_GEO_KEY);
      expect(error).toBeInstanceOf(ApiEnvError);
      expect(error instanceof ApiEnvError ? error.reasons : []).toEqual([MAPBOX_REASON]);
    }
    // The reason travels with the other refusals.
    const both = refusal(infra('ci', { GEO_PROVIDER: 'mapbox', APP_SECRET: 'x' }));
    expect(both.variables).toEqual(['APP_SECRET', 'GEO_PROVIDER']);
    expect(both.message).toContain(MAPBOX_REASON);
    // Any other value is refused by name alone.
    const other = refusal(infra('ci', { GEO_PROVIDER: 'fixture-provider' }));
    expect(other.variables).toEqual(['GEO_PROVIDER']);
    expect(other).not.toBeInstanceOf(ApiEnvError);
    expect(other.message).not.toContain('fixture-provider');
  });

  it('the caps default to 85,000 and 2,800', () => {
    const unset = load(infra('ci'));
    expect([unset.GEO_MONTHLY_CAP, unset.GEO_DAILY_CAP]).toEqual([85_000, 2_800]);
    const set = load(infra('ci', { GEO_MONTHLY_CAP: '50000', GEO_DAILY_CAP: '200' }));
    expect([set.GEO_MONTHLY_CAP, set.GEO_DAILY_CAP]).toEqual([50_000, 200]);
    for (const variable of ['GEO_MONTHLY_CAP', 'GEO_DAILY_CAP']) {
      for (const value of ['0', '-1', '1.5', 'x', '10000001']) {
        expect(refusal(infra('ci', { [variable]: value })).variables).toEqual([variable]);
      }
    }
  });
});
