import { createInstance } from 'i18next';
import type { i18n } from 'i18next';
import { BRAND } from '../brand.ts';
import { common } from './en/common.ts';
import { errors } from './en/errors.ts';
import { native } from './en/native.ts';
import { notifications } from './en/notifications.ts';

export const RESOURCES = { en: { common, errors, native, notifications } } as const;

export const NAMESPACES = ['common', 'errors', 'native', 'notifications'] as const;

export type Namespace = (typeof NAMESPACES)[number];

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof RESOURCES)['en'];
  }
}

/**
 * A new i18next instance, initialised synchronously with the catalogs, so `t` works on the next
 * line. `appName` defaults to the brand's display name; the app passes its variant's name.
 */
export function createI18n(options?: { lng?: 'en'; appName?: string }): i18n {
  const instance = createInstance();
  void instance.init({
    resources: RESOURCES,
    lng: options?.lng ?? 'en',
    fallbackLng: 'en',
    ns: NAMESPACES,
    defaultNS: 'common',
    initAsync: false,
    interpolation: {
      escapeValue: false,
      defaultVariables: { appName: options?.appName ?? BRAND.displayName },
    },
    returnNull: false,
  });
  return instance;
}
