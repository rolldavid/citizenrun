import { configureApiClient } from '@citizenrun/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { PlatformError } from '@/platform/shared';

import { phoneClientInfo, resolvePhoneApiOrigin } from './origin';
import type { ClientInfo, Session, SessionCallbacks } from './types';

let cachedClient: ClientInfo | null = null;
let cachedOrigin: string | null = null;
let callbacks: SessionCallbacks | null = null;
let configured = false;

/** One value of the build's `extra`, unknown until the caller narrows it. */
function extraValue(name: 'apiOrigin' | 'variant'): unknown {
  const extra: unknown = Constants.expoConfig?.extra;
  if (typeof extra !== 'object' || extra === null) {
    return undefined;
  }
  return Object.hasOwn(extra, name) ? Reflect.get(extra, name) : undefined;
}

function client(): ClientInfo {
  if (cachedClient === null) {
    const info = phoneClientInfo(
      Platform.OS === 'android' ? 'android' : 'ios',
      Constants.expoConfig?.version,
    );
    if (info === null) {
      throw new PlatformError('session', 'session.no_version');
    }
    cachedClient = info;
  }
  return cachedClient;
}

function apiOrigin(): string {
  if (cachedOrigin === null) {
    const origin = resolvePhoneApiOrigin({
      extraApiOrigin: extraValue('apiOrigin'),
      variant: extraValue('variant'),
      hostUri: Constants.expoConfig?.hostUri,
    });
    if (origin === null) {
      throw new PlatformError('session', 'session.no_origin');
    }
    cachedOrigin = origin;
  }
  return cachedOrigin;
}

export const session: Session = {
  credential: 'bearer',
  get client() {
    return client();
  },
  get apiOrigin() {
    return apiOrigin();
  },
  configure: (next) => {
    callbacks = next;
    if (configured) {
      return;
    }
    configureApiClient({
      origin: apiOrigin(),
      clientHeader: client().header,
      getAuthorization: () => null, // the token arrives with PM-session-tokens
      credentials: 'omit',
      onUnauthorized: () => {
        callbacks?.onUnauthorized();
      },
      onUpgradeRequired: () => {
        callbacks?.onUpgradeRequired();
      },
    });
    configured = true;
  },
};

export type * from './types';
