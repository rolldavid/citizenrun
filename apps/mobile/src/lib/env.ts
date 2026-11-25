import { parseSafeUrl, SOURCE_URL_MAX } from '@citizenrun/shared';
import { z } from 'zod';

export type AppEnv = Readonly<{
  /** EXPO_PUBLIC_APP_STORE_URL: the iOS store listing; null while unset (OI-store-records). */
  appStoreUrl: string | null;
  /** EXPO_PUBLIC_PLAY_STORE_URL: the Android store listing; null while unset (OI-store-records). */
  playStoreUrl: string | null;
  /** EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID; null while unset (OI-google-oauth). */
  googleIosClientId: string | null;
  /** EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID; null while unset (OI-google-oauth). */
  googleWebClientId: string | null;
  /** EXPO_PUBLIC_APPLE_SERVICES_ID; null while unset (OI-apple-identifiers). */
  appleServicesId: string | null;
}>;

export type SignInIds = {
  googleIosClientId: string | null;
  googleWebClientId: string | null;
  appleServicesId: string | null;
};

function signInId(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
}

/** The three sign-in ids; an empty or blank value reads as unset (null). */
export function readSignInIds(source: {
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: string | undefined;
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: string | undefined;
  EXPO_PUBLIC_APPLE_SERVICES_ID: string | undefined;
}): SignInIds {
  return {
    googleIosClientId: signInId(source.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    googleWebClientId: signInId(source.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
    appleServicesId: signInId(source.EXPO_PUBLIC_APPLE_SERVICES_ID),
  };
}

const RawAppEnvSchema = z.object({
  EXPO_PUBLIC_APP_STORE_URL: z.string().optional(),
  EXPO_PUBLIC_PLAY_STORE_URL: z.string().optional(),
});

function storeUrl(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  if (text === '') {
    return null;
  }
  return parseSafeUrl(text, SOURCE_URL_MAX)?.url ?? null;
}

/** Pure: parses the raw values. Empty, unset or not a safe https link reads as null. */
export function parseAppEnv(
  source: Readonly<Record<string, string | undefined>>,
): Omit<AppEnv, keyof SignInIds> {
  const parsed = RawAppEnvSchema.safeParse(source);
  if (!parsed.success) {
    return { appStoreUrl: null, playStoreUrl: null };
  }
  return {
    appStoreUrl: storeUrl(parsed.data.EXPO_PUBLIC_APP_STORE_URL),
    playStoreUrl: storeUrl(parsed.data.EXPO_PUBLIC_PLAY_STORE_URL),
  };
}

let cached: AppEnv | null = null;

/** The values Metro inlined into this bundle, parsed once on the first call. */
export function getAppEnv(): AppEnv {
  // Each value is a literal member access: Metro inlines no other form.
  cached ??= {
    ...parseAppEnv({
      EXPO_PUBLIC_APP_STORE_URL: process.env.EXPO_PUBLIC_APP_STORE_URL,
      EXPO_PUBLIC_PLAY_STORE_URL: process.env.EXPO_PUBLIC_PLAY_STORE_URL,
    }),
    ...readSignInIds({
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      EXPO_PUBLIC_APPLE_SERVICES_ID: process.env.EXPO_PUBLIC_APPLE_SERVICES_ID,
    }),
  };
  return cached;
}
