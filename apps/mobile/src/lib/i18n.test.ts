import '@formatjs/intl-pluralrules/polyfill-force.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';

import { brandVariant } from '@citizenrun/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as I18nModule from './i18n';

type FixtureLocale = { languageCode: string | null };
type FixtureConfig = { extra?: Record<string, unknown> };

const device = vi.hoisted(() => {
  const state: { locales: FixtureLocale[]; expoConfig: FixtureConfig | null } = {
    locales: [{ languageCode: 'en' }],
    expoConfig: null,
  };
  return state;
});

vi.mock('expo-localization', () => ({ getLocales: () => device.locales }));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return device.expoConfig;
    },
  },
}));

/** A loose view of the instance: the probe and fixture keys are not in the typed catalog. */
type LooseTranslate = { t: (key: string, options?: Record<string, unknown>) => string };

async function loadFresh(): Promise<typeof I18nModule> {
  vi.resetModules();
  return import('./i18n');
}

beforeEach(() => {
  device.locales = [{ languageCode: 'en' }];
  device.expoConfig = null;
});

describe('appLanguage and getI18n', () => {
  it('the language comes from the device', async () => {
    device.locales = [{ languageCode: 'fr' }];
    const { appLanguage, getI18n } = await loadFresh();
    expect(appLanguage()).toBe('fr');
    expect(getI18n().language).toBe('fr');
  });

  it('a device with no language uses English', async () => {
    const { appLanguage } = await loadFresh();
    device.locales = [];
    expect(appLanguage()).toBe('en');
    device.locales = [{ languageCode: null }];
    expect(appLanguage()).toBe('en');
    device.locales = [{ languageCode: '' }];
    expect(appLanguage()).toBe('en');
  });

  it('appName is the variant’s display name', async () => {
    device.expoConfig = { extra: { variant: 'staging' } };
    const { getI18n } = await loadFresh();
    const instance = getI18n();
    instance.addResource('en', 'common', 'appNameProbe', '{{appName}}');
    const key: string = 'common:appNameProbe';
    const loose = instance as unknown as LooseTranslate; // the probe key is not in the typed catalog
    expect(loose.t(key)).toBe(brandVariant('staging').displayName);
  });

  it('an unknown variant uses the development name', async () => {
    const { appVariant } = await loadFresh();
    device.expoConfig = { extra: { variant: 'nope' } };
    expect(appVariant()).toBe('development');
    device.expoConfig = { extra: {} };
    expect(appVariant()).toBe('development');
    device.expoConfig = null;
    expect(appVariant()).toBe('development');
    device.expoConfig = { extra: { variant: 'toString' } };
    expect(appVariant()).toBe('development');
    device.expoConfig = { extra: { variant: 'production' } };
    expect(appVariant()).toBe('production');
  });

  it('one instance', async () => {
    const { getI18n } = await loadFresh();
    expect(getI18n()).toBe(getI18n());
  });

  it('plural keys resolve the same everywhere', async () => {
    const { getI18n } = await loadFresh();
    const instance = getI18n();
    const ns: string = 'pluralFixture';
    const key: string = 'item';
    instance.addResourceBundle('en', ns, {
      item_one: '{{count}} item',
      item_other: '{{count}} items',
    });
    const loose = instance as unknown as LooseTranslate; // the fixture namespace is not in the typed catalog
    expect([0, 1, 2].map((count) => loose.t(`${ns}:${key}`, { count }))).toEqual([
      '0 items',
      '1 item',
      '2 items',
    ]);
  });
});
