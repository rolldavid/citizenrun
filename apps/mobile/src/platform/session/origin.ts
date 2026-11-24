import { BRAND, brandVariant, siteOrigin } from '@citizenrun/shared';
import type { BrandVariantName } from '@citizenrun/shared';

import type { ClientInfo } from './types';

export const DEV_API_PORT = 8080; // the local API's port
export const APP_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/; // PM-session

const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const TRAILING_PORT = /:\d+$/;

function appVersionOf(version: unknown): string | null {
  return typeof version === 'string' && APP_VERSION_PATTERN.test(version) ? version : null;
}

/** ClientInfo for a phone; null when the version does not match APP_VERSION_PATTERN. */
export function phoneClientInfo(platform: 'ios' | 'android', version: unknown): ClientInfo | null {
  const appVersion = appVersionOf(version);
  if (appVersion === null) {
    return null;
  }
  return { platform, appVersion, header: `${platform}/${appVersion}` };
}

/** ClientInfo for the web: '<version>' and 'web/<version>' when it matches, else '0.0.0' and the bare 'web'. */
export function webClientInfo(version: unknown): ClientInfo {
  const appVersion = appVersionOf(version);
  if (appVersion === null) {
    return { platform: 'web', appVersion: '0.0.0', header: 'web' };
  }
  return { platform: 'web', appVersion, header: `web/${appVersion}` };
}

function isVariantName(variant: unknown): variant is BrandVariantName {
  return typeof variant === 'string' && Object.hasOwn(BRAND.variants, variant);
}

function hostOf(hostUri: string): string {
  const withoutScheme = hostUri.replace(SCHEME_PREFIX, '');
  const slash = withoutScheme.indexOf('/');
  const authority = slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
  return authority.replace(TRAILING_PORT, '');
}

/** The phone API origin by PM-session's order, or null when none can be found. */
export function resolvePhoneApiOrigin(input: {
  extraApiOrigin: unknown;
  variant: unknown;
  hostUri: unknown;
}): string | null {
  const { extraApiOrigin, variant, hostUri } = input;
  if (typeof extraApiOrigin === 'string' && extraApiOrigin !== '') {
    return extraApiOrigin;
  }
  if (isVariantName(variant) && brandVariant(variant).host !== null) {
    return siteOrigin(variant);
  }
  if (variant === 'development' && typeof hostUri === 'string') {
    const host = hostOf(hostUri);
    if (host !== '') {
      return 'http://' + host + ':' + String(DEV_API_PORT);
    }
  }
  return null;
}
