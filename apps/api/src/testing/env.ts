import { fileURLToPath } from 'node:url';
import { brandVariant, siteOrigin, variantForAppEnv } from '@citizenrun/shared';
import { loadEnv } from '../env.ts';
import type { ApiEnv } from '../env.ts';

// The fixture web export the web tests serve.
const FIXTURE_WEB_DIST_DIR = fileURLToPath(new URL('../web/__fixtures__/dist', import.meta.url));
// A URL no unit test connects to; createTestApp passes the worker's database instead.
const UNIT_DATABASE_URL =
  'postgres://citizenrun:citizenrun@localhost:5432/unit_tests_never_connect';
// A bucket no unit test reaches; createTestApp passes the worker's media bucket instead.
const UNIT_MEDIA_BUCKET = 'unit-tests-never-connect';

// A visibly fixed test key, never a real secret.
const TEST_APP_SECRET = '0123456789abcdef'.repeat(4);

// The harness's object-store settings and their local defaults.
function testSetting(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

// The origin of a test environment whose brand variant has no host.
const FIXTURE_PUBLIC_URL = 'https://app.example.test';

/**
 * The `PUBLIC_URL` a test environment of `appEnv` uses. A deployed environment's must name its
 * variant's host once brand.json holds one (01 section 10.3), so it is that variant's site origin;
 * every other environment, and a variant with no host yet, uses the fixture origin.
 */
export function testPublicUrl(appEnv: string | undefined): string {
  if (appEnv !== 'staging' && appEnv !== 'production') {
    return FIXTURE_PUBLIC_URL;
  }
  const variant = variantForAppEnv(appEnv);
  return brandVariant(variant).host === null ? FIXTURE_PUBLIC_URL : siteOrigin(variant);
}

/**
 * The API environment of a test (TEST-harness-app's values), passed through loadEnv so
 * every derived value comes from env.ts. An override replaces a value; `undefined` removes it.
 */
export function testApiEnv(overrides: Record<string, string | undefined> = {}): ApiEnv {
  const source: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    APP_ENV: 'ci',
    PORT: '8080',
    LOG_LEVEL: 'debug',
    DATABASE_URL: UNIT_DATABASE_URL,
    PUBLIC_URL: testPublicUrl(overrides.APP_ENV ?? 'ci'),
    WEB_DIST_DIR: FIXTURE_WEB_DIST_DIR,
    MIN_CLIENT_VERSION_IOS: '1.0.0',
    MIN_CLIENT_VERSION_ANDROID: '1.0.0',
    MIN_CLIENT_VERSION_WEB: '1.0.0',
    MEDIA_BUCKET: UNIT_MEDIA_BUCKET,
    MEDIA_ENDPOINT: testSetting('TEST_S3_ENDPOINT', 'http://localhost:8333'),
    MEDIA_REGION: 'us-east-1',
    MEDIA_ACCESS_KEY_ID: testSetting('TEST_S3_ACCESS_KEY_ID', 'osdev'),
    MEDIA_SECRET_ACCESS_KEY: testSetting('TEST_S3_SECRET_ACCESS_KEY', 'osdev-secret-key'),
    S3_FORCE_PATH_STYLE: 'true',
    APP_SECRET: TEST_APP_SECRET,
    CLIENT_IP_HEADER: 'x-real-ip',
    ADMIN_EMAILS: 'admin@example.test',
    ...overrides,
  };
  return loadEnv({ defaultWebDistDir: FIXTURE_WEB_DIST_DIR }, source);
}
