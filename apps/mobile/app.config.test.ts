import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { color, FONT_FILES, fixed, goHost } from '@citizenrun/shared';
import { getConfig } from 'expo/config';
import type { ExpoConfig } from 'expo/config';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildConfig, googleIosUrlScheme } from './app.config.ts';
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

// The app's own rule, loaded through Vitest's resolver: the app's `@/` imports are outside this file's
// type-check project.
const { iosUrlSchemeFor } = await vi.importActual<{ iosUrlSchemeFor: (id: string) => string }>(
  './src/platform/auth/google-config.ts',
);

const FIXTURE_HOST = 'staging.example.test';

/** The committed brand with no host written in any variant. */
const unhostedBrand: BrandJson = {
  ...brand,
  domain: null,
  variants: {
    development: { ...brand.variants.development, host: null, adminHost: null },
    staging: { ...brand.variants.staging, host: null, adminHost: null },
    production: { ...brand.variants.production, host: null, adminHost: null },
  },
};

/** Fixture owner values and a fixture staging host; production keeps no host. */
const fixtureBrand: BrandJson = {
  ...unhostedBrand,
  expo: { owner: 'fixture-owner', projectId: 'fixture-project' },
  variants: {
    ...unhostedBrand.variants,
    staging: { ...unhostedBrand.variants.staging, host: FIXTURE_HOST },
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

// The config plugins, in the order app.config.ts must keep while the iOS Google client id is unset;
// expo-age-range is left out because it ships no config plugin.
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

// The Google sign-in library's pods that need module maps, while its own plugin entry is omitted.
const GOOGLE_SIGN_IN_PODS = [
  { name: 'AppCheckCore', modular_headers: true },
  { name: 'GoogleUtilities', modular_headers: true },
  { name: 'RecaptchaInterop', modular_headers: true },
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
      { android: { usesCleartextTraffic: true }, ios: { extraPods: GOOGLE_SIGN_IN_PODS } },
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
        { android: { usesCleartextTraffic: false }, ios: { extraPods: GOOGLE_SIGN_IN_PODS } },
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

    expect(() =>
      build('production', { brand: unhostedBrand, env: { API_VARIANT: 'staging' } }),
    ).toThrow('brand.json variants.staging.host is not set');

    // The committed staging host, once written, is the origin a build for it gets.
    const stagingHost = brand.variants.staging.host;
    if (stagingHost !== null) {
      expect(build('production', { env: { API_VARIANT: 'staging' } }).extra).toMatchObject({
        apiOrigin: `https://${stagingHost}`,
        apiVariant: 'staging',
      });
    }

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

describe('the Google sign-in plugin', () => {
  const FIXTURE_IOS_CLIENT_ID = '123-abc.apps.googleusercontent.com';

  it('the Google plugin is absent while the iOS client id is unset', () => {
    for (const variant of VARIANTS) {
      expect(plugin(build(variant), 'react-native-nitro-google-signin')).toBeUndefined();
    }
  });

  it('the Google plugin carries the reversed iOS client id', () => {
    const config = build('development', {
      env: { EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: FIXTURE_IOS_CLIENT_ID },
    });
    expect(plugin(config, 'react-native-nitro-google-signin')).toEqual([
      'react-native-nitro-google-signin',
      { iosUrlScheme: 'com.googleusercontent.apps.123-abc' },
    ]);
    const names = config.plugins?.map(pluginName) ?? [];
    expect(names.indexOf('react-native-nitro-google-signin')).toBe(
      names.indexOf('expo-apple-authentication') + 1,
    );
    expect(config.ios).not.toHaveProperty('googleServicesFile');
    expect(config.android).not.toHaveProperty('googleServicesFile');
    // The plugin entry writes the module maps itself, so the build properties do not repeat them.
    expect(plugin(config, 'expo-build-properties')).toEqual([
      'expo-build-properties',
      { android: { usesCleartextTraffic: true } },
    ]);
  });

  it('the two scheme rules agree', () => {
    for (const id of [
      FIXTURE_IOS_CLIENT_ID,
      '000000000000-fixture.apps.googleusercontent.com',
      '987654321-a1b2c3d4e5f6.apps.googleusercontent.com',
    ]) {
      expect(googleIosUrlScheme(id)).toBe(iosUrlSchemeFor(id));
    }
    expect(() => googleIosUrlScheme('not-a-client-id')).toThrow('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
  });

  it("Expo's loader reads the iOS client id from the environment", () => {
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', '');
    const unset = getConfig(MOBILE_DIR, { skipSDKVersionRequirement: true }).exp;
    expect(plugin(unset, 'react-native-nitro-google-signin')).toBeUndefined();
    vi.stubEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', FIXTURE_IOS_CLIENT_ID);
    const set = getConfig(MOBILE_DIR, { skipSDKVersionRequirement: true }).exp;
    expect(plugin(set, 'react-native-nitro-google-signin')).toEqual([
      'react-native-nitro-google-signin',
      { iosUrlScheme: 'com.googleusercontent.apps.123-abc' },
    ]);
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
