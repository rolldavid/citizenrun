import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import type { AppEnv } from '@/lib/env';
import { storage } from '@/platform/storage';
import { links as fakeLinks, linksFake } from '@/test/platform/links';

import nativeSource from './index.native.ts?raw';
import { isIssuedUrlAllowed } from './issued-url';
import webSource from './index.web.ts?raw';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const rn = vi.hoisted(() => {
  const Platform: { OS: string } = { OS: 'ios' };
  return {
    Platform,
    Linking: {
      openURL: (_url: string): Promise<unknown> => Promise.resolve(true),
      openSettings: (): Promise<void> => Promise.resolve(),
    },
  };
});

// The sign-in ids stay unset: the links read the two store listings only.
const NO_SIGN_IN = { googleIosClientId: null, googleWebClientId: null, appleServicesId: null };

const env = vi.hoisted(() => {
  const state: { value: AppEnv } = {
    value: {
      appStoreUrl: null,
      playStoreUrl: null,
      googleIosClientId: null,
      googleWebClientId: null,
      appleServicesId: null,
    },
  };
  return state;
});

vi.mock('react-native', () => rn);
vi.mock('@/lib/env', () => ({ getAppEnv: (): AppEnv => env.value }));

const { links: phone } = await vi.importActual<typeof NativeIndex>('./index.native');
const { links: web } = await vi.importActual<typeof WebIndex>('./index.web');

const page = {
  open: vi.fn((_url: string, _target: string, _features: string): null => null),
  location: { reload: vi.fn(), href: '' },
};

function httpsUrl(length: number): string {
  const base = 'https://example.test/';
  return base + 'a'.repeat(length - base.length);
}

// A presigned download is longer than SOURCE_URL_MAX; a fixture, not a real signature.
const ISSUED_URL = httpsUrl(2100);
const REFUSED_ISSUED_URLS = [
  'javascript:alert(1)',
  'data:text/html,x',
  'file:///etc/hosts',
  'http://example.com/x',
];
const LOCAL_ISSUED_URLS = ['http://localhost:9000/x', 'http://127.0.0.1:8333/x'];

let openURL: MockInstance<(url: string) => Promise<unknown>>;
let openSettings: MockInstance<() => Promise<void>>;

beforeEach(async () => {
  rn.Platform.OS = 'ios';
  env.value = { appStoreUrl: null, playStoreUrl: null, ...NO_SIGN_IN };
  openURL = vi.spyOn(rn.Linking, 'openURL').mockResolvedValue(true);
  openSettings = vi.spyOn(rn.Linking, 'openSettings').mockResolvedValue(undefined);
  page.open.mockReset().mockReturnValue(null);
  page.location.reload.mockReset();
  page.location.href = '';
  vi.stubGlobal('window', page);
  await storage.hydrate();
  storage.remove('reload.chunkReloaded');
  storage.remove('reload.upgradeReloaded');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('links', () => {
  it('external links use the system browser', async () => {
    expect(await phone.openExternal('https://example.test/a')).toBe('opened');
    expect(openURL).toHaveBeenCalledWith('https://example.test/a');
    expect(await web.openExternal('https://example.test/a')).toBe('opened');
    expect(page.open).toHaveBeenCalledWith(
      'https://example.test/a',
      '_blank',
      'noopener,noreferrer',
    );
    expect(nativeSource).not.toContain('expo-web-browser');
    expect(webSource).not.toContain('expo-web-browser');
  });

  it('the web opens the tab inside the caller', () => {
    void web.openExternal('https://example.test/a');
    expect(page.open).toHaveBeenCalledTimes(1);
  });

  it('bad links are refused', async () => {
    for (const url of [
      'http://x.org',
      'https://user:pw@x.org',
      'https://10.0.0.1/',
      httpsUrl(2049),
      'javascript:alert(1)',
    ]) {
      expect(await phone.openExternal(url)).toBe('refused');
      expect(await web.openExternal(url)).toBe('refused');
    }
    expect(openURL).not.toHaveBeenCalled();
    expect(page.open).not.toHaveBeenCalled();
  });

  it('a long source link opens', async () => {
    for (const url of [httpsUrl(201), httpsUrl(2048)]) {
      expect(await phone.openExternal(url)).toBe('opened');
      expect(await web.openExternal(url)).toBe('opened');
    }
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(page.open).toHaveBeenCalledTimes(2);
  });

  it('a link the system cannot open fails', async () => {
    openURL.mockRejectedValue(new Error('fixture'));
    expect(await phone.openExternal('https://example.test/a')).toBe('failed');
    page.open.mockImplementation(() => {
      throw new Error('fixture');
    });
    expect(await web.openExternal('https://example.test/a')).toBe('failed');
  });

  it('issued URLs', async () => {
    expect(ISSUED_URL.length).toBe(2100);
    expect(await phone.openIssuedUrl(ISSUED_URL)).toBe('opened');
    expect(openURL).toHaveBeenCalledWith(ISSUED_URL);
    expect(await web.openIssuedUrl(ISSUED_URL)).toBe('opened');
    expect(page.open).toHaveBeenCalledWith(ISSUED_URL, '_blank', 'noopener,noreferrer');

    openURL.mockClear();
    page.open.mockClear();
    for (const url of REFUSED_ISSUED_URLS) {
      expect(await phone.openIssuedUrl(url)).toBe('refused');
      expect(await web.openIssuedUrl(url)).toBe('refused');
    }
    expect(openURL).not.toHaveBeenCalled();
    expect(page.open).not.toHaveBeenCalled();

    for (const url of LOCAL_ISSUED_URLS) {
      expect(await phone.openIssuedUrl(url)).toBe('opened');
      expect(openURL).toHaveBeenLastCalledWith(url);
      expect(await web.openIssuedUrl(url)).toBe('opened');
      expect(page.open).toHaveBeenLastCalledWith(url, '_blank', 'noopener,noreferrer');
    }
  });

  it('the web opens an issued URL inside the caller', () => {
    void web.openIssuedUrl(ISSUED_URL);
    expect(page.open).toHaveBeenCalledTimes(1);
  });

  it('issued URL failure', async () => {
    openURL.mockRejectedValue(new Error('fixture'));
    expect(await phone.openIssuedUrl(ISSUED_URL)).toBe('failed');
    page.open.mockImplementation(() => {
      throw new Error('fixture');
    });
    expect(await web.openIssuedUrl(ISSUED_URL)).toBe('failed');
  });

  it('isIssuedUrlAllowed', () => {
    expect(isIssuedUrlAllowed(ISSUED_URL)).toBe(true);
    for (const url of REFUSED_ISSUED_URLS) {
      expect(isIssuedUrlAllowed(url)).toBe(false);
    }
    for (const url of LOCAL_ISSUED_URLS) {
      expect(isIssuedUrlAllowed(url)).toBe(true);
    }
    expect(isIssuedUrlAllowed('not a url')).toBe(false);
    expect(isIssuedUrlAllowed('')).toBe(false);
    // https is always allowed, whatever the host
    expect(isIssuedUrlAllowed('https://localhost.example.test/x')).toBe(true);
    expect(isIssuedUrlAllowed('https://10.0.0.1:9000/x')).toBe(true);
    // http only on the two local hosts, matched exactly
    expect(isIssuedUrlAllowed('http://localhost.example.test/x')).toBe(false);
    expect(isIssuedUrlAllowed('http://127.0.0.2/x')).toBe(false);
    expect(isIssuedUrlAllowed('http://localhost@example.test/x')).toBe(false);
    expect(isIssuedUrlAllowed('ftp://localhost/x')).toBe(false);
  });

  it('the fake records no URL', async () => {
    linksFake.scriptIssuedUrl('failed');
    expect(await fakeLinks.openIssuedUrl(ISSUED_URL)).toBe('failed');
    expect(linksFake.calls).toEqual([{ op: 'openIssuedUrl' }]);
    expect(JSON.stringify(linksFake.calls)).not.toContain('example.test');
    linksFake.reset();
    expect(await fakeLinks.openIssuedUrl(ISSUED_URL)).toBe('opened');
  });

  it('mail', async () => {
    expect(await phone.openMail('help@example.test')).toBe('opened');
    expect(openURL).toHaveBeenCalledWith('mailto:help@example.test');
    expect(await web.openMail('help@example.test')).toBe('opened');
    expect(page.location.href).toBe('mailto:help@example.test');

    openURL.mockClear();
    page.location.href = '';
    expect(await phone.openMail('not an address')).toBe('refused');
    expect(await web.openMail('not an address')).toBe('refused');
    expect(openURL).not.toHaveBeenCalled();
    expect(page.location.href).toBe('');

    openURL.mockRejectedValue(new Error('fixture'));
    expect(await phone.openMail('help@example.test')).toBe('failed');
  });

  it('app settings', async () => {
    expect(await phone.openAppSettings()).toBe(true);
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRejectedValue(new Error('fixture'));
    expect(await phone.openAppSettings()).toBe(false);
    openSettings.mockClear();
    expect(await web.openAppSettings()).toBe(false);
    expect(openSettings).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('store listing follows the store URL', async () => {
    for (const os of ['ios', 'android']) {
      rn.Platform.OS = os;
      expect(phone.storeListingSupported).toBe(false);
      expect(await phone.openStoreListing()).toBe(false);
    }
    expect(openURL).not.toHaveBeenCalled();

    rn.Platform.OS = 'ios';
    env.value = {
      appStoreUrl: 'https://apps.example.test/app/id1',
      playStoreUrl: null,
      ...NO_SIGN_IN,
    };
    expect(phone.storeListingSupported).toBe(true);
    expect(await phone.openStoreListing()).toBe(true);
    expect(openURL).toHaveBeenLastCalledWith('https://apps.example.test/app/id1');

    rn.Platform.OS = 'android';
    expect(phone.storeListingSupported).toBe(false);
    expect(await phone.openStoreListing()).toBe(false);
    env.value = {
      appStoreUrl: 'https://apps.example.test/app/id1',
      playStoreUrl: 'https://play.example.test/store/apps',
      ...NO_SIGN_IN,
    };
    expect(phone.storeListingSupported).toBe(true);
    expect(await phone.openStoreListing()).toBe(true);
    expect(openURL).toHaveBeenLastCalledWith('https://play.example.test/store/apps');

    openURL.mockRejectedValue(new Error('fixture'));
    expect(await phone.openStoreListing()).toBe(false);

    expect(web.storeListingSupported).toBe(false);
    expect(await web.openStoreListing()).toBe(false);
  });

  it('reload once', () => {
    expect(web.reloadOnce('chunk_error')).toBe(true);
    expect(page.location.reload).toHaveBeenCalledTimes(1);
    expect(storage.get('reload.chunkReloaded')).toBe(true);
    expect(web.reloadOnce('chunk_error')).toBe(false);
    expect(page.location.reload).toHaveBeenCalledTimes(1);
    expect(web.reloadOnce('upgrade_required')).toBe(true);
    expect(page.location.reload).toHaveBeenCalledTimes(2);
    expect(web.reloadOnce('upgrade_required')).toBe(false);
    expect(page.location.reload).toHaveBeenCalledTimes(2);

    storage.remove('reload.chunkReloaded');
    vi.spyOn(storage, 'get').mockImplementation(() => {
      throw new Error('fixture: not hydrated');
    });
    expect(web.reloadOnce('chunk_error')).toBe(false);
    expect(page.location.reload).toHaveBeenCalledTimes(2);

    expect(phone.reloadOnce('chunk_error')).toBe(false);
    expect(phone.reloadOnce('upgrade_required')).toBe(false);
    expect(page.location.reload).toHaveBeenCalledTimes(2);
  });
});
