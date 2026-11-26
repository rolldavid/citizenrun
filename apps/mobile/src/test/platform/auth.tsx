import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import type {
  AppleSignInButtonProps,
  AppleSignInResult,
  Auth,
  GoogleSignInButtonProps,
  GoogleSignInResult,
  ProviderAvailability,
} from '@/platform/auth/types';

export type AuthFakeCall =
  | { op: 'mount'; provider: 'apple'; nonceHash: string; state: string }
  | { op: 'mount'; provider: 'google'; nonceHash: string }
  | { op: 'clearProviderState' };

const DEFAULT_AVAILABILITY: ProviderAvailability = { apple: true, google: true };

const calls: AuthFakeCall[] = [];
const state: {
  availability: ProviderAvailability;
  apple: AppleSignInButtonProps | null;
  google: GoogleSignInButtonProps | null;
} = { availability: DEFAULT_AVAILABILITY, apple: null, google: null };

function AppleSignInButton(props: AppleSignInButtonProps): ReactElement {
  const { nonceHash, state: appleState, testID, accessibilityLabel, disabled } = props;
  useEffect(() => {
    calls.push({ op: 'mount', provider: 'apple', nonceHash, state: appleState });
  }, [nonceHash, appleState]);
  // Registered in an effect with a cleanup, so an unmounted button is never called.
  useEffect(() => {
    state.apple = props;
    return () => {
      if (state.apple === props) {
        state.apple = null;
      }
    };
  });
  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    />
  );
}

function GoogleSignInButton(props: GoogleSignInButtonProps): ReactElement {
  const { nonceHash, testID, accessibilityLabel, disabled } = props;
  useEffect(() => {
    calls.push({ op: 'mount', provider: 'google', nonceHash });
  }, [nonceHash]);
  useEffect(() => {
    state.google = props;
    return () => {
      if (state.google === props) {
        state.google = null;
      }
    };
  });
  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    />
  );
}

export const auth: Auth = {
  prepare: () => Promise.resolve(state.availability),
  AppleSignInButton,
  GoogleSignInButton,
  clearProviderState: () => {
    calls.push({ op: 'clearProviderState' });
    return Promise.resolve();
  },
};

export const authFake = {
  calls: calls as readonly AuthFakeCall[],
  scriptAvailability: (availability: ProviderAvailability): void => {
    state.availability = availability;
  },
  /** Calls the mounted Apple button's onStart, then its onResult; nothing when none is mounted. */
  emitApple: (result: AppleSignInResult): void => {
    const button = state.apple;
    if (button !== null) {
      button.onStart();
      button.onResult(result);
    }
  },
  /** Calls the mounted Google button's onStart, then its onResult; nothing when none is mounted. */
  emitGoogle: (result: GoogleSignInResult): void => {
    const button = state.google;
    if (button !== null) {
      button.onStart();
      button.onResult(result);
    }
  },
  reset: (): void => {
    calls.length = 0;
    state.availability = DEFAULT_AVAILABILITY;
    state.apple = null;
    state.google = null;
  },
};
