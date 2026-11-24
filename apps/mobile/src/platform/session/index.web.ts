import { configureApiClient } from '@citizenrun/shared';
import Constants from 'expo-constants';

import { webClientInfo } from './origin';
import type { Session, SessionCallbacks } from './types';

let callbacks: SessionCallbacks | null = null;
let configured = false;

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
};

export type * from './types';
