import type { ExpoConfig } from 'expo/config';

// Expo's config loader does not transpile imported TypeScript, so this file imports no workspace
// code: the brand data and the permission texts are read as JSON inside the default export.

type VariantName = 'development' | 'staging' | 'production';

type BrandVariantJson = {
  displayName: string;
  scheme: string;
  iosBundleId: string;
  androidPackage: string;
  host: string | null;
  adminHost: string | null;
  appleServicesId: string | null;
};

/** The shape of brand.json. */
export type BrandJson = {
  displayName: string;
  slug: string;
  domain: string | null;
  expo: { owner: string | null; projectId: string | null };
  github: { repository: string };
  contacts: {
    supportEmail: string | null;
    postalAddress: string | null;
    dmcaAgent: {
      name: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
    };
    childSafetyContact: { name: string | null; email: string | null };
  };
  variants: Record<VariantName, BrandVariantJson>;
};

export type BuildInput = {
  variant: VariantName;
  brand: BrandJson;
  strings: { ios: Readonly<Record<string, string>> };
  env: { EXPO_PUBLIC_API_ORIGIN?: string; API_VARIANT?: string; GOOGLE_SERVICES_JSON?: string };
};

const VARIANTS: readonly VariantName[] = ['development', 'staging', 'production'];

// The four bundled faces, by their FONT_FILES names (D-271, D-293).
const FONT_NAMES = [
  'SpecialGothic-Regular',
  'SpecialGothic-Medium',
  'SpecialGothic-Bold',
  'ChivoMono-Medium',
] as const;

// The link paths a variant's host opens in the app (D-166).
const LINK_PATH_PREFIXES = [
  '/explore',
  '/office/',
  '/c/',
  '/u/',
  '/p/',
  '/messages',
  '/settings',
  '/activity',
] as const;

function isVariantName(value: string): value is VariantName {
  return (VARIANTS as readonly string[]).includes(value);
}

function nativeText(strings: BuildInput['strings'], key: string): string {
  const text = strings.ios[key];
  if (text === undefined) {
    throw new Error(`native-strings.en.json has no ios.${key}`);
  }
  return text;
}

function apiOriginOf(
  brand: BrandJson,
  env: BuildInput['env'],
): { apiOrigin: string | null; apiVariant: string | null } {
  const apiVariant = env.API_VARIANT ?? null;
  if (env.EXPO_PUBLIC_API_ORIGIN !== undefined) {
    return { apiOrigin: env.EXPO_PUBLIC_API_ORIGIN, apiVariant };
  }
  if (apiVariant === null) {
    return { apiOrigin: null, apiVariant: null };
  }
  if (!isVariantName(apiVariant)) {
    throw new Error('API_VARIANT must be development, staging or production');
  }
  const host = brand.variants[apiVariant].host;
  if (host === null) {
    throw new Error(`brand.json variants.${apiVariant}.host is not set`);
  }
  return { apiOrigin: `https://${host}`, apiVariant };
}

/** The Expo configuration of one variant, built from the brand data, the native texts and the build's variables. */
export function buildConfig(input: BuildInput): ExpoConfig {
  const { variant, brand, strings, env } = input;
  const v = brand.variants[variant];
  const isDevelopment = variant === 'development';
  const linkHost = isDevelopment ? null : v.host;
  const { owner, projectId } = brand.expo;
  const { apiOrigin, apiVariant } = apiOriginOf(brand, env);

  return {
    name: v.displayName,
    slug: brand.slug,
    ...(owner === null ? {} : { owner }),
    scheme: v.scheme,
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    icon: './assets/images/icon.png',
    runtimeVersion: { policy: 'fingerprint' },
    ...(projectId === null ? {} : { updates: { url: `https://u.expo.dev/${projectId}` } }),
    ios: {
      bundleIdentifier: v.iosBundleId,
      supportsTablet: false,
      usesAppleSignIn: true,
      config: { usesNonExemptEncryption: false },
      ...(linkHost === null
        ? {}
        : { associatedDomains: [`applinks:${linkHost}`, `applinks:go.${linkHost}`] }),
      entitlements: { 'com.apple.developer.declared-age-range': true },
      infoPlist: {
        NSCalendarsWriteOnlyAccessUsageDescription: nativeText(
          strings,
          'NSCalendarsWriteOnlyAccessUsageDescription',
        ),
        ...(isDevelopment ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
      },
    },
    android: {
      package: v.androidPackage,
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        monochromeImage: './assets/images/adaptive-icon-monochrome.png',
        backgroundColor: '#141412', // fixed.appIconField
      },
      ...(linkHost === null
        ? {}
        : {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                category: ['BROWSABLE', 'DEFAULT'],
                data: [
                  ...LINK_PATH_PREFIXES.map((pathPrefix) => ({
                    scheme: 'https',
                    host: linkHost,
                    pathPrefix,
                  })),
                  { scheme: 'https', host: linkHost, path: '/' },
                ],
              },
            ],
          }),
      ...(env.GOOGLE_SERVICES_JSON === undefined
        ? {}
        : { googleServicesFile: env.GOOGLE_SERVICES_JSON }),
    },
    web: { output: 'single', bundler: 'metro', favicon: './assets/images/favicon.png' },
    experiments: { typedRoutes: true, reactCompiler: true },
    locales: { en: './native-strings.en.json' },
    extra: {
      variant,
      host: v.host,
      apiOrigin,
      apiVariant,
      ...(projectId === null ? {} : { eas: { projectId } }),
    },
    plugins: [
      'expo-router',
      ['expo-dev-client', { launchMode: 'most-recent' }],
      ['expo-build-properties', { android: { usesCleartextTraffic: isDevelopment } }],
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 176,
          resizeMode: 'contain',
          backgroundColor: '#F1EFE7', // color.light.bg
          dark: {
            image: './assets/images/splash-icon-dark.png',
            backgroundColor: '#121210', // color.dark.bg
          },
        },
      ],
      [
        'expo-font',
        { fonts: FONT_NAMES.map((name) => `../../packages/cards/assets/fonts/${name}.ttf`) },
      ],
      ['expo-localization', { supportedLocales: { ios: ['en'], android: ['en'] } }],
      ['expo-secure-store', { faceIDPermission: false, configureAndroidBackup: true }],
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#7C7A72', // fixed.notificationTint
          defaultChannel: 'default',
          enableBackgroundRemoteNotifications: false,
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission: nativeText(strings, 'NSLocationWhenInUseUsageDescription'),
          isIosBackgroundLocationEnabled: false,
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
      [
        'expo-calendar',
        { calendarPermission: nativeText(strings, 'NSCalendarsFullAccessUsageDescription') },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: nativeText(strings, 'NSPhotoLibraryUsageDescription'),
          cameraPermission: nativeText(strings, 'NSCameraUsageDescription'),
          microphonePermission: nativeText(strings, 'NSMicrophoneUsageDescription'),
        },
      ],
      ['expo-video', { supportsBackgroundPlayback: false, supportsPictureInPicture: false }],
      'expo-apple-authentication',
      // expo-age-range ships no config plugin in this SDK; its one setting is the entitlement above.
      '@maplibre/maplibre-react-native',
      'react-native-compressor',
    ],
  };
}

function variantFromEnv(value: string | undefined): VariantName {
  if (value === undefined || value === '') {
    return 'development';
  }
  if (!isVariantName(value)) {
    throw new Error('APP_VARIANT must be development, staging or production');
  }
  return value;
}

function setValue(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

// Expo calls this with its ConfigContext; nothing in it is used, because no static app.json exists.
export default (): ExpoConfig => {
  const brand = require('../../brand.json') as BrandJson; // shape checked by app.config.test.ts
  const strings = require('./native-strings.en.json') as BuildInput['strings']; // shape checked by app.config.test.ts
  const apiOrigin = setValue(process.env.EXPO_PUBLIC_API_ORIGIN);
  const apiVariant = setValue(process.env.API_VARIANT);
  const googleServices = setValue(process.env.GOOGLE_SERVICES_JSON);
  return buildConfig({
    variant: variantFromEnv(process.env.APP_VARIANT),
    brand,
    strings,
    env: {
      ...(apiOrigin === undefined ? {} : { EXPO_PUBLIC_API_ORIGIN: apiOrigin }),
      ...(apiVariant === undefined ? {} : { API_VARIANT: apiVariant }),
      ...(googleServices === undefined ? {} : { GOOGLE_SERVICES_JSON: googleServices }),
    },
  });
};
