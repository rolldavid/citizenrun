import { focusManager, onlineManager } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import type { NetworkState } from 'expo-network';
import { AppState } from 'react-native';

import { createAppQueryClient } from './defaults';
import type { QueryClientModule } from './types';

let client: QueryClient | null = null;

function get(): QueryClient {
  client ??= createAppQueryClient();
  return client;
}

function isOnline(state: NetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export const queryClient: QueryClientModule = {
  get,
  start: () => {
    focusManager.setEventListener((handleFocus) => {
      const sub = AppState.addEventListener('change', (state) => {
        handleFocus(state === 'active');
      });
      return () => {
        sub.remove();
      };
    });
    onlineManager.setEventListener((setOnline) => {
      let eventSeen = false;
      const sub = Network.addNetworkStateListener((state) => {
        eventSeen = true;
        setOnline(isOnline(state));
      });
      void Network.getNetworkStateAsync()
        .then((state) => {
          // an older answer never overwrites a newer event
          if (!eventSeen) {
            setOnline(isOnline(state));
          }
        })
        .catch(() => undefined);
      return () => {
        sub.remove();
      };
    });
    let unwired = false;
    return () => {
      if (unwired) {
        return;
      }
      unwired = true;
      focusManager.setEventListener(() => undefined);
      onlineManager.setEventListener(() => undefined);
    };
  },
  clear: () => {
    get().clear();
  },
};

export type * from './types';
