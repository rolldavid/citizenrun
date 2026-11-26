import type { TFunction } from 'i18next';

/** The catalogs the settings screens read. */
export const SETTINGS_NAMESPACES = [
  'settings',
  'common',
  'errors',
  'auth',
  'onboarding',
  'profile',
] as const;

/** The translate function of a component that reads those catalogs. */
export type SettingsT = TFunction<typeof SETTINGS_NAMESPACES>;
