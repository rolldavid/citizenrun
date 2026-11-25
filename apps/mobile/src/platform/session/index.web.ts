import { configureApiClient } from '@citizenrun/shared';
import Constants from 'expo-constants';

import { auth } from '@/platform/auth';
import { queryClient } from '@/platform/query-client';
import { storage } from '@/platform/storage';

import { webClientInfo } from './origin';
import type { Session, SessionCallbacks } from './types';

let callbacks: SessionCallbacks | null = null;
let configured = false;

// CTL-11: the HttpOnly cookie is cleared by the server; the page clears drafts, the query cache and provider
// state, each step in its own try.
async function endLocal(): Promise<void> {
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
  credential: 'cookie',
  get client() {
    return webClientInfo(Constants.expoConfig?.version);
  },
  apiOrigin: '', // same origin (D-032)
  configure: (next) => {
    callbacks = next;
    if (configured) {
      return;
    }
    configureApiClient({
      origin: '',
      clientHeader: webClientInfo(Constants.expoConfig?.version).header,
      getAuthorization: () => null,
      credentials: 'same-origin',
      onUnauthorized: () => {
        callbacks?.onUnauthorized();
      },
      onUpgradeRequired: () => {
        callbacks?.onUpgradeRequired();
      },
    });
    configured = true;
  },
  // the cookie is invisible to JavaScript, so GET /v1/me decides
  hydrate: () => Promise.resolve('unknown'),
  // the response set the cookie
  adopt: () => Promise.resolve(),
  endLocal: () => endLocal(),
};

export type * from './types';
