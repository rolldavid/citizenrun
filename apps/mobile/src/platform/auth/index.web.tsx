import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactElement } from 'react';
import { View } from 'react-native';

import { getAppEnv } from '@/lib/env';

import type {
  AppleSignInButtonProps,
  AppleSignInResult,
  Auth,
  GoogleSignInButtonProps,
  ProviderAvailability,
} from './types';

type AppleIdInitOptions = {
  clientId: string;
  scope: string;
  redirectURI: string;
  state: string;
  nonce: string;
  usePopup: boolean;
};

type AppleIdGlobal = { auth: { init(options: AppleIdInitOptions): void } };

type GoogleCredentialResponse = { credential?: string };

type GoogleIdConfiguration = {
  client_id: string;
  callback(response: GoogleCredentialResponse): void;
  nonce: string;
  auto_select: boolean;
  ux_mode: 'popup';
  context: 'signin';
  itp_support: boolean;
};

type GoogleButtonConfiguration = {
  type: 'standard';
  theme: string;
  shape: string;
  size: string;
  text: 'continue_with';
  logo_alignment: 'left';
  width: number;
  click_listener(): void;
};

type GoogleGlobal = {
  accounts: {
    id: {
      initialize(configuration: GoogleIdConfiguration): void;
      renderButton(parent: HTMLElement, options: GoogleButtonConfiguration): void;
      disableAutoSelect(): void;
    };
  };
};

declare global {
  interface Window {
    AppleID?: AppleIdGlobal;
    google?: GoogleGlobal;
  }
}

const APPLE_SCRIPT =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
const SCRIPT_TIMEOUT_MS = 10_000;
/** Google's button wording option (renderButton's `text`), not text this module draws. */
const GOOGLE_BUTTON_WORDING = 'continue_with';

const scripts = new Map<string, Promise<boolean>>();
let availability: Promise<ProviderAvailability> | null = null;

/** Adds one async script per source, once; true on load, false on error or after the timeout. */
function loadScript(src: string): Promise<boolean> {
  const existing = scripts.get(src);
  if (existing !== undefined) {
    return existing;
  }
  const loading = new Promise<boolean>((resolve) => {
    const element = document.createElement('script');
    element.src = src;
    element.async = true;
    const timer = setTimeout(() => {
      resolve(false);
    }, SCRIPT_TIMEOUT_MS);
    element.addEventListener('load', () => {
      clearTimeout(timer);
      resolve(true);
    });
    element.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    document.head.appendChild(element);
  });
  scripts.set(src, loading);
  return loading;
}

async function computeAvailability(): Promise<ProviderAvailability> {
  // A provider whose id is unset loads no script (INV-09).
  const env = getAppEnv();
  const [apple, google] = await Promise.all([
    env.appleServicesId === null ? Promise.resolve(false) : loadScript(APPLE_SCRIPT),
    env.googleWebClientId === null ? Promise.resolve(false) : loadScript(GOOGLE_SCRIPT),
  ]);
  return { apple, google };
}

function domNode(ref: ComponentRef<typeof View> | null): HTMLElement | null {
  // react-native-web hands a View's ref over as its DOM element.
  return ref as unknown as HTMLElement | null;
}

function textOf(record: unknown, key: string): string | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }
  const value: unknown = Reflect.get(record, key);
  return typeof value === 'string' ? value : null;
}

function detailOf(event: Event): unknown {
  return event instanceof CustomEvent ? (event.detail as unknown) : null;
}

/** AppleIDSignInOnSuccess's detail as an AppleSignInResult. */
function appleSuccess(detail: unknown): AppleSignInResult {
  const authorization: unknown =
    typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'authorization') : null;
  const idToken = textOf(authorization, 'id_token');
  if (idToken === null || idToken === '') {
    return { kind: 'failed', code: 'auth.no_token' };
  }
  const user: unknown =
    typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'user') : null;
  const name: unknown =
    typeof user === 'object' && user !== null ? Reflect.get(user, 'name') : null;
  const hasName = typeof name === 'object' && name !== null;
  return {
    kind: 'token',
    idToken,
    code: textOf(authorization, 'code'),
    name: hasName
      ? { givenName: textOf(name, 'firstName'), familyName: textOf(name, 'lastName') }
      : null,
  };
}

/** AppleIDSignInOnFailure's detail as an AppleSignInResult. */
function appleFailure(detail: unknown): AppleSignInResult {
  return textOf(detail, 'error') === 'popup_closed_by_user'
    ? { kind: 'cancelled' }
    : { kind: 'failed', code: 'auth.provider_error' };
}

function AppleSignInButton(props: AppleSignInButtonProps): ReactElement {
  const { appearance, disabled, testID, accessibilityLabel, nonceHash, state } = props;
  const container = useRef<ComponentRef<typeof View>>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const node = domNode(container.current);
    if (node === null) {
      return;
    }
    node.id = 'appleid-signin';
    node.setAttribute('data-mode', 'center-align');
    node.setAttribute('data-type', 'continue');
    node.setAttribute('data-color', appearance.appleStyle === 'black' ? 'black' : 'white');
    if (appearance.appleStyle === 'white_outline') {
      node.setAttribute('data-border', 'true');
    } else {
      node.removeAttribute('data-border');
    }
    node.setAttribute('data-width', String(appearance.width));
    node.setAttribute('data-height', String(appearance.height));
  }, [appearance.appleStyle, appearance.width, appearance.height]);

  useEffect(() => {
    const appleId = window.AppleID;
    const clientId = getAppEnv().appleServicesId;
    if (appleId === undefined || clientId === null) {
      return;
    }
    try {
      appleId.auth.init({
        clientId,
        scope: 'name email',
        redirectURI: window.location.origin + '/v1/auth/apple/callback',
        state,
        nonce: nonceHash,
        usePopup: true,
      });
    } catch {
      // The script's own failure: the press answers through AppleIDSignInOnFailure or not at all.
    }
  }, [nonceHash, state]);

  useEffect(() => {
    const node = domNode(container.current);
    if (window.AppleID === undefined || node === null) {
      return;
    }
    const onClick = (): void => {
      latest.current.onStart();
    };
    const onSuccess = (event: Event): void => {
      latest.current.onResult(appleSuccess(detailOf(event)));
    };
    const onFailure = (event: Event): void => {
      latest.current.onResult(appleFailure(detailOf(event)));
    };
    node.addEventListener('click', onClick);
    document.addEventListener('AppleIDSignInOnSuccess', onSuccess);
    document.addEventListener('AppleIDSignInOnFailure', onFailure);
    return () => {
      node.removeEventListener('click', onClick);
      document.removeEventListener('AppleIDSignInOnSuccess', onSuccess);
      document.removeEventListener('AppleIDSignInOnFailure', onFailure);
    };
  }, []);

  // The provider's script draws the button inside; the slot is a named group, since an element with
  // no role may carry no name.
  return (
    <View
      ref={container}
      testID={testID}
      role="group"
      aria-label={accessibilityLabel}
      pointerEvents={disabled ? 'none' : 'auto'}
    />
  );
}

function GoogleSignInButton(props: GoogleSignInButtonProps): ReactElement {
  const { appearance, disabled, testID, accessibilityLabel, nonceHash } = props;
  const container = useRef<ComponentRef<typeof View>>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const { googleTheme, googleShape, googleSize, width } = appearance;

  useEffect(() => {
    const google = window.google;
    const clientId = getAppEnv().googleWebClientId;
    const node = domNode(container.current);
    if (google === undefined || clientId === null || node === null) {
      return;
    }
    try {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          const idToken = response.credential ?? '';
          latest.current.onResult(
            idToken === '' ? { kind: 'failed', code: 'auth.no_token' } : { kind: 'token', idToken },
          );
        },
        nonce: nonceHash,
        auto_select: false,
        ux_mode: 'popup',
        context: 'signin',
        itp_support: true,
      });
      google.accounts.id.renderButton(node, {
        type: 'standard',
        theme: googleTheme,
        shape: googleShape,
        size: googleSize,
        text: GOOGLE_BUTTON_WORDING,
        logo_alignment: 'left',
        width,
        click_listener: () => {
          latest.current.onStart();
        },
      });
    } catch {
      // The script's own failure: nothing is drawn and nothing is answered.
    }
  }, [nonceHash, googleTheme, googleShape, googleSize, width]);

  return (
    <View
      ref={container}
      testID={testID}
      role="group"
      aria-label={accessibilityLabel}
      pointerEvents={disabled ? 'none' : 'auto'}
    />
  );
}

export const auth: Auth = {
  prepare: () => {
    availability ??= computeAvailability();
    return availability;
  },
  AppleSignInButton,
  GoogleSignInButton,
  clearProviderState: () => {
    try {
      window.google?.accounts.id.disableAutoSelect();
    } catch {
      // Errors are dropped (PM-auth).
    }
    return Promise.resolve();
  },
};

export type * from './types';
