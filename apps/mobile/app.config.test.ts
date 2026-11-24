import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { color, FONT_FILES, fixed, goHost } from '@citizenrun/shared';
import { getConfig } from 'expo/config';
import type { ExpoConfig } from 'expo/config';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildConfig } from './app.config.ts';
import type { BrandJson, BuildInput } from './app.config.ts';

const MOBILE_DIR = import.meta.dirname;
const ROOT_DIR = resolve(MOBILE_DIR, '../..');

const VariantSchema = z.object({
  displayName: z.string(),
  scheme: z.string(),
  iosBundleId: z.string(),
  androidPackage: z.string(),
  host: z.string().nullable(),
  adminHost: z.string().nullable(),
  appleServicesId: z.string().nullable(),
});

// The shape app.config.ts assumes when it requires brand.json.
const BrandSchema = z.object({
  displayName: z.string(),
  slug: z.string(),
  domain: z.string().nullable(),
  expo: z.object({ owner: z.string().nullable(), projectId: z.string().nullable() }),
  github: z.object({ repository: z.string() }),
  contacts: z.object({
    supportEmail: z.string().nullable(),
    postalAddress: z.string().nullable(),
    dmcaAgent: z.object({
      name: z.string().nullable(),
      address: z.string().nullable(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
    }),
    childSafetyContact: z.object({ name: z.string().nullable(), email: z.string().nullable() }),
  }),
  variants: z.object({
    development: VariantSchema,
    staging: VariantSchema,
    production: VariantSchema,
  }),
});

// The shape app.config.ts assumes when it requires native-strings.en.json.
const StringsSchema = z.object({ ios: z.record(z.string(), z.string()) });

const brand: BrandJson = BrandSchema.parse(
  JSON.parse(readFileSync(resolve(ROOT_DIR, 'brand.json'), 'utf8')),
);
const strings: BuildInput['strings'] = StringsSchema.parse(
  JSON.parse(readFileSync(resolve(MOBILE_DIR, 'native-strings.en.json'), 'utf8')),
);

const VARIANTS = ['development', 'staging', 'production'] as const;

const FIXTURE_HOST = 'staging.example.test';

/** The committed brand with fixture owner values and a fixture staging host. */
const fixtureBrand: BrandJson = {
  ...brand,
  expo: { owner: 'fixture-owner', projectId: 'fixture-project' },
  variants: {
    ...brand.variants,
    staging: { ...brand.variants.staging, host: FIXTURE_HOST },
  },
};

const LINK_PATH_PREFIXES = [
  '/explore',
  '/office/',
  '/c/',
  '/u/',
  '/p/',
  '/messages',
  '/settings',
  '/activity',
];

// The config plugins, in the order app.config.ts must keep. Google sign-in joins with the
// first sign-in work; expo-age-range is left out because it ships no config plugin.
const PLUGIN_ORDER = [
  'expo-router',
  'expo-dev-client',
  'expo-build-properties',
  'expo-splash-screen',
  'expo-font',
  'expo-localization',
  'expo-secure-store',
  'expo-notifications',
  'expo-location',
  'expo-calendar',
  'expo-image-picker',
  'expo-video',
  'expo-apple-authentication',
  '@maplibre/maplibre-react-native',
  'react-native-compressor',
];

function build(
  variant: BuildInput['variant'],
  options: { brand?: BrandJson; env?: BuildInput['env'] } = {},
): ExpoConfig {
  return buildConfig({
    variant,
    brand: options.brand ?? brand,
    strings,
    env: options.env ?? {},
  });
}

function pluginName(entry: NonNullable<ExpoConfig['plugins']>[number]): unknown {
  return Array.isArray(entry) ? entry[0] : entry;
}

function plugin(config: ExpoConfig, name: string): unknown {
  return config.plugins?.find((entry) => pluginName(entry) === name);
}

function text(key: string): string {
  const value = strings.ios[key];
  if (value === undefined) {
    throw new Error(`native-strings.en.json has no ios.${key}`);
  }
  return value;
}

describe('buildConfig', () => {
  it('development uses the development identifiers', () => {
    const config = build('development');
    const v = brand.variants.development;
    expect(config.name).toBe(v.displayName);
    expect(config.scheme).toBe(v.scheme);
    expect(config.ios?.bundleIdentifier).toBe(v.iosBundleId);
    expect(config.android?.package).toBe(v.androidPackage);
    expect(config).not.toHaveProperty('owner');
    expect(config).not.toHaveProperty('updates');
    expect(config.extra).not.toHaveProperty('eas');
    expect(config.ios).not.toHaveProperty('associatedDomains');
    expect(config.android).not.toHaveProperty('intentFilters');
    expect(config.ios?.infoPlist).toMatchObject({
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    });
    expect(plugin(config, 'expo-build-properties')).toEqual([
      'expo-build-properties',
      { android: { usesCleartextTraffic: true } },
    ]);
  });

  it('keeps development free of link domains even when its brand host is set', () => {
    const withHost: BrandJson = {
      ...brand,
      variants: {
        ...brand.variants,
        development: { ...brand.variants.development, host: 'dev.example.test' },
      },
    };
    const config = build('development', { brand: withHost });
    expect(config.ios).not.toHaveProperty('associatedDomains');
    expect(config.android).not.toHaveProperty('intentFilters');
  });

  it('staging and production allow no clear text', () => {
    for (const variant of ['staging', 'production'] as const) {
      const config = build(variant);
      expect(config.name).toBe(brand.variants[variant].displayName);
      expect(config.ios?.infoPlist).not.toHaveProperty('NSAppTransportSecurity');
      expect(plugin(config, 'expo-build-properties')).toEqual([
        'expo-build-properties',
        { android: { usesCleartextTraffic: false } },
      ]);
    }
  });

  it('every variant asks for the age-range entitlement and outputs a single-page web build', () => {
    for (const variant of VARIANTS) {
      const config = build(variant);
      expect(config.ios?.entitlements).toEqual({ 'com.apple.developer.declared-age-range': true });
      expect(config.web).toEqual({
        output: 'single',
        bundler: 'metro',
        favicon: './assets/images/favicon.png',
      });
      expect(config.runtimeVersion).toEqual({ policy: 'fingerprint' });
      expect(config.experiments).toEqual({ typedRoutes: true, reactCompiler: true });
      expect(config.version).toBe('0.1.0');
      expect(config.locales).toEqual({ en: './native-strings.en.json' });
    }
  });

  it('owner values switch fields on', () => {
    const config = build('staging', { brand: fixtureBrand });
    expect(config.owner).toBe('fixture-owner');
    expect(config.updates).toEqual({ url: 'https://u.expo.dev/fixture-project' });
    expect(config.extra).toMatchObject({ eas: { projectId: 'fixture-project' } });
    expect(config.ios?.associatedDomains).toEqual([
      'applinks:staging.example.test',
      'applinks:go.staging.example.test',
    ]);
    expect(config.android?.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [
          ...LINK_PATH_PREFIXES.map((pathPrefix) => ({
            scheme: 'https',
            host: FIXTURE_HOST,
            pathPrefix,
          })),
          { scheme: 'https', host: FIXTURE_HOST, path: '/' },
        ],
      },
    ]);
    // A variant without a host keeps its links off in the same brand.
    expect(build('production', { brand: fixtureBrand }).ios).not.toHaveProperty(
      'associatedDomains',
    );

    for (const variant of ['staging', 'production'] as const) {
      if (brand.variants[variant].host === null) {
        continue;
      }
      expect(build(variant).ios?.associatedDomains?.[1]).toBe(`applinks:${goHost(variant)}`);
    }
  });

  it('apiOrigin follows its rule', () => {
    const explicit = build('development', {
      env: { EXPO_PUBLIC_API_ORIGIN: 'http://192.0.2.10:8080' },
    }).extra;
    expect(explicit).toMatchObject({ apiOrigin: 'http://192.0.2.10:8080' });
    expect(explicit).not.toHaveProperty('apiVariant');

    expect(
      build('production', { brand: fixtureBrand, env: { API_VARIANT: 'staging' } }).extra,
    ).toMatchObject({ apiOrigin: 'https://staging.example.test', apiVariant: 'staging' });

    expect(() => build('production', { env: { API_VARIANT: 'staging' } })).toThrow(
      'brand.json variants.staging.host is not set',
    );

    const unset = build('development').extra;
    expect(unset).toMatchObject({ variant: 'development' });
    expect(unset).not.toHaveProperty('host');
    expect(unset).not.toHaveProperty('apiOrigin');
    expect(unset).not.toHaveProperty('apiVariant');
  });

  it('extra holds no null value', () => {
    function nullPaths(value: unknown, path: string): string[] {
      if (value === null) {
        return [path];
      }
      if (typeof value !== 'object') {
        return [];
      }
      return Object.entries(value).flatMap(([key, inner]) => nullPaths(inner, `${path}.${key}`));
    }

    const envs: BuildInput['env'][] = [
      {},
      { EXPO_PUBLIC_API_ORIGIN: 'http://192.0.2.10:8080' },
      { API_VARIANT: 'staging' },
      { EXPO_PUBLIC_API_ORIGIN: 'http://192.0.2.10:8080', API_VARIANT: 'staging' },
    ];
    for (const variant of VARIANTS) {
      for (const source of [brand, fixtureBrand]) {
        for (const env of envs) {
          const needsHost =
            env.API_VARIANT !== undefined && env.EXPO_PUBLIC_API_ORIGIN === undefined;
          const config = build(variant, { brand: needsHost ? fixtureBrand : source, env });
          expect(config.extra).toMatchObject({ variant });
          expect(nullPaths(config.extra, 'extra')).toEqual([]);
        }
      }
    }
  });

  it('identity colors are the tokens', () => {
    const config = build('production');
    expect(config.android?.adaptiveIcon).toEqual({
      foregroundImage: './assets/images/adaptive-icon.png',
      monochromeImage: './assets/images/adaptive-icon-monochrome.png',
      backgroundColor: fixed.appIconField,
    });
    expect(plugin(config, 'expo-splash-screen')).toEqual([
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 176,
        resizeMode: 'contain',
        backgroundColor: color.light.bg,
        dark: { image: './assets/images/splash-icon-dark.png', backgroundColor: color.dark.bg },
      },
    ]);
    expect(plugin(config, 'expo-notifications')).toEqual([
      'expo-notifications',
      {
        icon: './assets/images/notification-icon.png',
        color: fixed.notificationTint,
        defaultChannel: 'default',
        enableBackgroundRemoteNotifications: false,
      },
    ]);
  });

  it('plugin and permission texts come from the native catalog', () => {
    const config = build('staging');
    expect(config.ios?.infoPlist).toMatchObject({
      NSCalendarsWriteOnlyAccessUsageDescription: text(
        'NSCalendarsWriteOnlyAccessUsageDescription',
      ),
    });
    expect(plugin(config, 'expo-location')).toEqual([
      'expo-location',
      {
        locationWhenInUsePermission: text('NSLocationWhenInUseUsageDescription'),
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ]);
    expect(plugin(config, 'expo-calendar')).toEqual([
      'expo-calendar',
      { calendarPermission: text('NSCalendarsFullAccessUsageDescription') },
    ]);
    expect(text('NSCalendarsFullAccessUsageDescription')).toBe(text('NSCalendarsUsageDescription'));
    expect(plugin(config, 'expo-image-picker')).toEqual([
      'expo-image-picker',
      {
        photosPermission: text('NSPhotoLibraryUsageDescription'),
        cameraPermission: text('NSCameraUsageDescription'),
        microphonePermission: text('NSMicrophoneUsageDescription'),
      },
    ]);
    expect(config.plugins?.map(pluginName)).toEqual(PLUGIN_ORDER);
  });

  it('a missing native text stops the build, naming the key', () => {
    const rest = Object.fromEntries(
      Object.entries(strings.ios).filter(([key]) => key !== 'NSCameraUsageDescription'),
    );
    expect(() =>
      buildConfig({ variant: 'development', brand, strings: { ios: rest }, env: {} }),
    ).toThrow('native-strings.en.json has no ios.NSCameraUsageDescription');
  });

  it('the four fonts are embedded', () => {
    const fonts = Object.values(FONT_FILES).map(
      (name) => `../../packages/cards/assets/fonts/${name}.ttf`,
    );
    expect(plugin(build('development'), 'expo-font')).toEqual(['expo-font', { fonts }]);
    for (const path of fonts) {
      expect(existsSync(resolve(MOBILE_DIR, path))).toBe(true);
    }
  });

  it('Google services only when given', () => {
    expect(build('production').android).not.toHaveProperty('googleServicesFile');
    expect(
      build('production', { env: { GOOGLE_SERVICES_JSON: 'fixture/google-services.json' } }).android
        ?.googleServicesFile,
    ).toBe('fixture/google-services.json');
  });
});

describe('the app.config.ts default export', () => {
  it("Expo's own loader reads the file", () => {
    for (const variant of VARIANTS) {
      vi.stubEnv('APP_VARIANT', variant);
      const { exp } = getConfig(MOBILE_DIR, { skipSDKVersionRequirement: true });
      expect(exp.name).toBe(brand.variants[variant].displayName);
      expect(exp.extra).toMatchObject({ variant });
    }
  });

  it('defaults to the development variant', () => {
    const { exp } = getConfig(MOBILE_DIR, { skipSDKVersionRequirement: true });
    expect(exp.name).toBe(brand.variants.development.displayName);
  });

  it('refuses an unknown APP_VARIANT, naming the variable', () => {
    vi.stubEnv('APP_VARIANT', 'fixture-variant');
    expect(() => getConfig(MOBILE_DIR, { skipSDKVersionRequirement: true })).toThrow('APP_VARIANT');
  });
});
