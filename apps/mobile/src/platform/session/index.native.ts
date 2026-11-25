import { configureApiClient } from '@citizenrun/shared';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { auth } from '@/platform/auth';
import { queryClient } from '@/platform/query-client';
import { PlatformError } from '@/platform/shared';
import { storage } from '@/platform/storage';

import { phoneClientInfo, resolvePhoneApiOrigin } from './origin';
import type { ClientInfo, Session, SessionCallbacks, SessionPresence } from './types';

// PM-session-tokens, D-170
const TOKEN_KEY = 'session.token';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
// An empty file in the document directory: the iOS keychain can survive an uninstall, the documents cannot.
const INSTALL_MARKER = 'session-install-v1';

/** The session token in memory; read only by getAuthorization. */
let token: string | null = null;
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

/** The members of expo-file-system's File the reinstall check uses (SDK 58: `exists`, the synchronous `create`). */
type MarkerFile = {
  readonly exists: boolean;
  create(): void;
};

function markerFile(): MarkerFile {
  const file: unknown = new File(Paths.document, INSTALL_MARKER);
  return file as MarkerFile; // the web type-check reads the library's web typing, whose File declares none of these members
}

async function deleteStoredToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY, STORE_OPTIONS);
}

/** Clears a token that survived a reinstall (the marker is gone with the old documents). */
async function checkReinstall(): Promise<void> {
  let marker: MarkerFile;
  try {
    marker = markerFile();
    if (marker.exists) {
      return;
    }
  } catch {
    return;
  }
  try {
    await deleteStoredToken();
  } catch {
    // dropped: a stale token is refused by the API and cleared then
  }
  try {
    marker.create();
  } catch {
    // dropped: the next start checks again
  }
}

async function hydrate(): Promise<SessionPresence> {
  await checkReinstall();
  let stored: string | null;
  try {
    stored = await SecureStore.getItemAsync(TOKEN_KEY, STORE_OPTIONS);
  } catch {
    return 'absent';
  }
  if (stored === null) {
    return 'absent';
  }
  if (!TOKEN_PATTERN.test(stored)) {
    try {
      await deleteStoredToken();
    } catch {
      // dropped
    }
    return 'absent';
  }
  token = stored;
  return 'present';
}

async function adopt(info: { token: string | null; expiresAt: string }): Promise<void> {
  const next = info.token;
  if (next === null) {
    return; // E-AUTH-02 intent 'add_email': the session is unchanged
  }
  if (!TOKEN_PATTERN.test(next)) {
    throw new PlatformError('session', 'session.store_failed');
  }
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, next, STORE_OPTIONS);
  } catch {
    throw new PlatformError('session', 'session.store_failed');
  }
  token = next;
}

// CTL-11: every step in its own try, so a failed step never stops the next.
async function endLocal(): Promise<void> {
  token = null;
  try {
    await deleteStoredToken();
  } catch {
    try {
      await deleteStoredToken();
    } catch {
      // dropped: a stale token is refused by the API and cleared then
    }
  }
  try {
    storage.clearUserData();
  } catch {
    // dropped
  }
  try {
    queryClient.clear();
  } catch {
    // dropped
  }
  try {
    await auth.clearProviderState();
  } catch {
    // dropped
  }
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
      getAuthorization: () => (token === null ? null : 'Bearer ' + token),
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
  hydrate,
  adopt,
  // the reason is for the callers and the fake; it is not stored
  endLocal: () => endLocal(),
};

export type * from './types';
