import { createElement, useEffect, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

import { auth } from '@/platform/auth';
import type { ProviderAvailability, ProviderButtonAppearance } from '@/platform/auth';

/** What the screen gives a provider button: the provider's variant and size, its id and its name. */
export type AuthButtonSpecimenProps = {
  appearance: ProviderButtonAppearance;
  testID: string;
  accessibilityLabel: string;
};

/** SCR-dev-auth-buttons: the two sign-in buttons the platform module draws, bound so that no sign-in starts. */
export type AuthButtonsViewModel = {
  /** What the module answers for this build and device; null until it has answered. */
  availability: ProviderAvailability | null;
  apple: ComponentType<AuthButtonSpecimenProps>;
  google: ComponentType<AuthButtonSpecimenProps>;
};

/** A specimen starts nothing and hears nothing back. */
function nothing(): void {
  // nothing to do
}

function AppleSpecimen(props: AuthButtonSpecimenProps): ReactElement {
  return createElement(auth.AppleSignInButton, {
    ...props,
    nonceHash: 'dev-nonce',
    state: 'dev-state',
    disabled: false,
    onStart: nothing,
    onResult: nothing,
  });
}

function GoogleSpecimen(props: AuthButtonSpecimenProps): ReactElement {
  return createElement(auth.GoogleSignInButton, {
    ...props,
    nonceHash: 'dev-nonce',
    disabled: false,
    onStart: nothing,
    onResult: nothing,
  });
}

/** Asks the module once which providers it offers here, and hands the screen its two buttons (PC6C-18). */
export function useAuthButtonsViewModel(): AuthButtonsViewModel {
  const [availability, setAvailability] = useState<ProviderAvailability | null>(null);

  useEffect(() => {
    let current = true;
    void auth.prepare().then((answer) => {
      if (current) {
        setAvailability(answer);
      }
    });
    return () => {
      current = false;
    };
  }, []);

  return { availability, apple: AppleSpecimen, google: GoogleSpecimen };
}
