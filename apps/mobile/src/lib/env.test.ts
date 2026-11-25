import { describe, expect, it, vi } from 'vitest';

import source from './env.ts?raw';
import * as envModule from './env';

const { parseAppEnv, readSignInIds } = envModule;

const SECRET_VARIABLES = [
  'DATABASE_URL',
  'API_DATABASE_URL',
  'WORKER_DATABASE_URL',
  'BACKUP_DATABASE_URL',
  'POSTGRES_PASSWORD',
  'API_DB_PASSWORD',
  'WORKER_DB_PASSWORD',
  'BACKUP_DB_PASSWORD',
  'APP_SECRET',
  'APP_SECRET_PREVIOUS',
  'MEDIA_ACCESS_KEY_ID',
  'MEDIA_SECRET_ACCESS_KEY',
  'DATA_ACCESS_KEY_ID',
  'DATA_SECRET_ACCESS_KEY',
  'BACKUPS_ACCESS_KEY_ID',
  'BACKUPS_SECRET_ACCESS_KEY',
  'LEGAL_ACCESS_KEY_ID',
  'LEGAL_SECRET_ACCESS_KEY',
  'RESEND_API_KEY',
  'RESEND_WEBHOOK_SECRET',
  'REVIEW_SIGNIN_CODE',
  'APPLE_PRIVATE_KEY',
  'GEO_API_KEY',
  'EXPO_ACCESS_TOKEN',
  'EXPO_TOKEN',
  'ANTHROPIC_API_KEY',
  'FEC_API_KEY',
  'GOOGLE_SERVICES_JSON',
  'RAILWAY_TOKEN',
  'RAILWAY_TOKEN_STAGING',
  'RAILWAY_TOKEN_PRODUCTION',
  'RAILWAY_API_TOKEN',
  'PERF_REVIEW_CODE',
];

const PUBLIC_PREFIX = 'EXPO_PUBLIC_';

describe('app env', () => {
  it('every variable read starts with EXPO_PUBLIC_ and none is a secret', () => {
    const names = [...source.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(
      (match) => match[1] ?? '',
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.startsWith(PUBLIC_PREFIX)).toBe(true);
      expect(SECRET_VARIABLES).not.toContain(name);
      expect(SECRET_VARIABLES).not.toContain(name.slice(PUBLIC_PREFIX.length));
    }
    expect(source).not.toContain('process.env[');
    expect(source).not.toContain('= process.env');
  });

  it('unset or empty store URLs read as null', () => {
    expect(parseAppEnv({})).toEqual({ appStoreUrl: null, playStoreUrl: null });
    expect(
      parseAppEnv({ EXPO_PUBLIC_APP_STORE_URL: '', EXPO_PUBLIC_PLAY_STORE_URL: '   ' }),
    ).toEqual({ appStoreUrl: null, playStoreUrl: null });
  });

  it('a store URL that is not a safe https link reads as null', () => {
    for (const value of [
      'http://apps.example.test/x',
      'javascript:alert(1)',
      'https://user:pw@apps.example.test/',
    ]) {
      expect(parseAppEnv({ EXPO_PUBLIC_APP_STORE_URL: value }).appStoreUrl).toBeNull();
      expect(parseAppEnv({ EXPO_PUBLIC_PLAY_STORE_URL: value }).playStoreUrl).toBeNull();
    }
  });

  it('a safe store URL is kept', () => {
    const url = 'https://apps.example.test/app/id1';
    expect(parseAppEnv({ EXPO_PUBLIC_APP_STORE_URL: url }).appStoreUrl).toBe(url);
    expect(parseAppEnv({ EXPO_PUBLIC_PLAY_STORE_URL: ` ${url} ` }).playStoreUrl).toBe(url);
  });

  it('readSignInIds reads empty as unset', () => {
    for (const value of ['', '   ', undefined]) {
      expect(
        readSignInIds({
          EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: value,
          EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: value,
          EXPO_PUBLIC_APPLE_SERVICES_ID: value,
        }),
      ).toEqual({ googleIosClientId: null, googleWebClientId: null, appleServicesId: null });
    }
  });

  it('readSignInIds trims', () => {
    expect(
      readSignInIds({
        EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: ' 123-abc.apps.googleusercontent.com ',
        EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '456-def.apps.googleusercontent.com\n',
        EXPO_PUBLIC_APPLE_SERVICES_ID: ' org.example.fixture.web',
      }),
    ).toEqual({
      googleIosClientId: '123-abc.apps.googleusercontent.com',
      googleWebClientId: '456-def.apps.googleusercontent.com',
      appleServicesId: 'org.example.fixture.web',
    });
  });

  it('getAppEnv() carries the three ids', async () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'fixture-ios.apps.googleusercontent.com');
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', ' fixture-web.apps.googleusercontent.com ');
    vi.stubEnv('EXPO_PUBLIC_APPLE_SERVICES_ID', '');
    vi.resetModules();
    const { getAppEnv } = await vi.importActual<typeof envModule>('./env');
    expect(getAppEnv()).toMatchObject({
      googleIosClientId: 'fixture-ios.apps.googleusercontent.com',
      googleWebClientId: 'fixture-web.apps.googleusercontent.com',
      appleServicesId: null,
    });
    vi.unstubAllEnvs();
  });

  it('every sign-in id is read by a literal member access', () => {
    for (const name of [
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
      'EXPO_PUBLIC_APPLE_SERVICES_ID',
    ]) {
      expect(source).toContain(`process.env.${name}`);
    }
  });

  it('getAppEnv reads the inlined variables once', async () => {
    vi.stubEnv('EXPO_PUBLIC_PLAY_STORE_URL', 'https://play.example.test/store/apps');
    vi.resetModules();
    const { getAppEnv } = await vi.importActual<typeof envModule>('./env');
    const first = getAppEnv();
    expect(first.playStoreUrl).toBe('https://play.example.test/store/apps');
    expect(first.appStoreUrl).toBeNull();

    vi.stubEnv('EXPO_PUBLIC_PLAY_STORE_URL', 'https://play.example.test/other');
    expect(getAppEnv()).toBe(first);
  });
});
