import { loadEnv } from '../env.ts';
import type { WorkerEnv } from '../env.ts';

// A URL no unit test connects to; runJob passes the worker's test database instead.
const UNIT_DATABASE_URL =
  'postgres://citizenrun:citizenrun@localhost:5432/unit_tests_never_connect';
// Buckets no unit test reaches; runJob passes the test `backups`, `media` and `data` buckets instead.
const UNIT_BACKUPS_BUCKET = 'unit-tests-never-connect';
const UNIT_MEDIA_BUCKET = 'unit-tests-never-connect';
const UNIT_DATA_BUCKET = 'unit-tests-never-connect';
// A visibly fixed test key, never a real secret; the same value as the API's test environment.
const TEST_APP_SECRET = '0123456789abcdef'.repeat(4);

// The harness's object-store settings and their local defaults.
function testSetting(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * The worker environment of a test, passed through loadEnv so every derived value comes from
 * env.ts: `ci`, the test object store, the fixture admin address and no Resend key or sender. An
 * override replaces a value; `undefined` removes it.
 */
export function testWorkerEnv(overrides: Record<string, string | undefined> = {}): WorkerEnv {
  const source: Record<string, string | undefined> = {
    NODE_ENV: 'test',
    APP_ENV: 'ci',
    LOG_LEVEL: 'debug',
    PUBLIC_URL: 'https://app.example.test',
    DATABASE_URL: UNIT_DATABASE_URL,
    BACKUPS_BUCKET: UNIT_BACKUPS_BUCKET,
    BACKUPS_ENDPOINT: testSetting('TEST_S3_ENDPOINT', 'http://localhost:8333'),
    BACKUPS_REGION: 'us-east-1',
    BACKUPS_ACCESS_KEY_ID: testSetting('TEST_S3_ACCESS_KEY_ID', 'osdev'),
    BACKUPS_SECRET_ACCESS_KEY: testSetting('TEST_S3_SECRET_ACCESS_KEY', 'osdev-secret-key'),
    MEDIA_BUCKET: UNIT_MEDIA_BUCKET,
    MEDIA_ENDPOINT: testSetting('TEST_S3_ENDPOINT', 'http://localhost:8333'),
    MEDIA_REGION: 'us-east-1',
    MEDIA_ACCESS_KEY_ID: testSetting('TEST_S3_ACCESS_KEY_ID', 'osdev'),
    MEDIA_SECRET_ACCESS_KEY: testSetting('TEST_S3_SECRET_ACCESS_KEY', 'osdev-secret-key'),
    DATA_BUCKET: UNIT_DATA_BUCKET,
    DATA_ENDPOINT: testSetting('TEST_S3_ENDPOINT', 'http://localhost:8333'),
    DATA_REGION: 'us-east-1',
    DATA_ACCESS_KEY_ID: testSetting('TEST_S3_ACCESS_KEY_ID', 'osdev'),
    DATA_SECRET_ACCESS_KEY: testSetting('TEST_S3_SECRET_ACCESS_KEY', 'osdev-secret-key'),
    S3_FORCE_PATH_STYLE: 'true',
    APP_SECRET: TEST_APP_SECRET,
    ADMIN_EMAILS: 'admin@example.test',
    ...overrides,
  };
  return loadEnv(source);
}
