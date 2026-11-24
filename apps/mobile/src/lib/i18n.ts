import { BRAND, brandVariant, createI18n } from '@citizenrun/shared';
import type { BrandVariantName } from '@citizenrun/shared';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import type { i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

let instance: I18n | null = null;

/** The device's language code (expo-localization), or 'en' when it has none. */
export function appLanguage(): string {
  const code = getLocales().at(0)?.languageCode;
  return code === undefined || code === null || code === '' ? 'en' : code;
}

function isVariantName(value: unknown): value is BrandVariantName {
  return typeof value === 'string' && Object.hasOwn(BRAND.variants, value);
}

/** The build's brand variant from extra.variant; 'development' when it is missing or not a variant name. */
export function appVariant(): BrandVariantName {
  const value: unknown = Constants.expoConfig?.extra?.variant;
  return isVariantName(value) ? value : 'development';
}

/** The app's one i18next instance, made on the first call. */
export function getI18n(): I18n {
  if (instance !== null) {
    return instance;
  }
  const created = createI18n({ appName: brandVariant(appVariant()).displayName });
  // createI18n has already initialised the instance, so the plugin is called directly; useTranslation then
  // resolves this instance outside an I18nextProvider too.
  initReactI18next.init(created);
  // In-memory catalogs and no backend: the language is set synchronously, with English as the fallback (D-185).
  void created.changeLanguage(appLanguage());
  instance = created;
  return created;
}
