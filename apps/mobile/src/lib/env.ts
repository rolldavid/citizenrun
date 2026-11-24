import { parseSafeUrl, SOURCE_URL_MAX } from '@citizenrun/shared';
import { z } from 'zod';

export type AppEnv = Readonly<{
  /** EXPO_PUBLIC_APP_STORE_URL: the iOS store listing; null while unset (OI-store-records). */
  appStoreUrl: string | null;
  /** EXPO_PUBLIC_PLAY_STORE_URL: the Android store listing; null while unset (OI-store-records). */
  playStoreUrl: string | null;
}>;

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
export function parseAppEnv(source: Readonly<Record<string, string | undefined>>): AppEnv {
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
  cached ??= parseAppEnv({
    EXPO_PUBLIC_APP_STORE_URL: process.env.EXPO_PUBLIC_APP_STORE_URL,
    EXPO_PUBLIC_PLAY_STORE_URL: process.env.EXPO_PUBLIC_PLAY_STORE_URL,
  });
  return cached;
}
