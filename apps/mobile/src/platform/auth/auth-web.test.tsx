import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WebIndex from './index.web';
import type {
  AppleSignInButtonProps,
  AppleSignInResult,
  Auth,
  GoogleSignInButtonProps,
  GoogleSignInResult,
  ProviderButtonAppearance,
} from './types';

const env = vi.hoisted(() => ({
  appStoreUrl: null,
  playStoreUrl: null,
  googleIosClientId: null as string | null,
  googleWebClientId: null as string | null,
  appleServicesId: null as string | null,
}));

vi.mock('@/lib/env', () => ({ getAppEnv: () => env }));

const APPLE_SCRIPT =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';

const APPEARANCE: ProviderButtonAppearance = {
  appleStyle: 'white_outline',
  googleTheme: 'filled_black',
  googleShape: 'pill',
  googleSize: 'large',
  width: 320,
  height: 44,
};

const onStart = vi.fn<() => void>();
const onResult = vi.fn<(result: AppleSignInResult | GoogleSignInResult) => void>();

async function load(): Promise<Auth> {
  vi.resetModules();
  return (await vi.importActual<typeof WebIndex>('./index.web')).auth;
}

function scriptsFor(src: string): HTMLScriptElement[] {
  return [...document.querySelectorAll('script')].filter((element) => element.src === src);
}

function appleProps(overrides: Partial<AppleSignInButtonProps> = {}): AppleSignInButtonProps {
  return {
    nonceHash: 'h1',
    state: 's',
    appearance: APPEARANCE,
    disabled: false,
    onStart,
    onResult,
    testID: 'auth.fixture-apple',
    accessibilityLabel: 'fixture-apple-label',
    ...overrides,
  };
}

function googleProps(overrides: Partial<GoogleSignInButtonProps> = {}): GoogleSignInButtonProps {
  return {
    nonceHash: 'h1',
    appearance: APPEARANCE,
    disabled: false,
    onStart,
    onResult,
    testID: 'auth.fixture-google',
    accessibilityLabel: 'fixture-google-label',
    ...overrides,
  };
}

type GoogleInit = { callback(response: { credential?: string }): void; nonce: string };
type GoogleRender = { click_listener(): void };

function stubProviders() {
  const appleInit = vi.fn();
  const initialize = vi.fn<(configuration: GoogleInit) => void>();
  const renderButton = vi.fn<(parent: HTMLElement, options: GoogleRender) => void>();
  const disableAutoSelect = vi.fn();
  vi.stubGlobal('AppleID', { auth: { init: appleInit } });
  vi.stubGlobal('google', { accounts: { id: { initialize, renderButton, disableAutoSelect } } });
  return { appleInit, initialize, renderButton, disableAutoSelect };
}

beforeEach(() => {
  onStart.mockReset();
  onResult.mockReset();
  env.googleWebClientId = null;
  env.appleServicesId = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const element of document.querySelectorAll('script')) {
    element.remove();
  }
});

describe('prepare', () => {
  it('no script without an id', async () => {
    const auth = await load();
    expect(await auth.prepare()).toEqual({ apple: false, google: false });
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('scripts load once', async () => {
    env.appleServicesId = 'svc.example.test';
    env.googleWebClientId = 'fixture-web.apps.googleusercontent.com';
    const auth = await load();
    const first = auth.prepare();
    const second = auth.prepare();
    expect(scriptsFor(APPLE_SCRIPT)).toHaveLength(1);
    expect(scriptsFor(GOOGLE_SCRIPT)).toHaveLength(1);
    expect(scriptsFor(APPLE_SCRIPT)[0]?.async).toBe(true);
    for (const element of document.querySelectorAll('script')) {
      element.dispatchEvent(new Event('load'));
    }
    expect(await first).toEqual({ apple: true, google: true });
    expect(await second).toEqual({ apple: true, google: true });
    expect(document.querySelectorAll('script')).toHaveLength(2);
  });

  it('a script that fails to load is unavailable', async () => {
    env.googleWebClientId = 'fixture-web.apps.googleusercontent.com';
    const auth = await load();
    const result = auth.prepare();
    scriptsFor(GOOGLE_SCRIPT)[0]?.dispatchEvent(new Event('error'));
    expect(await result).toEqual({ apple: false, google: false });
    expect(scriptsFor(APPLE_SCRIPT)).toHaveLength(0);
  });

  it('script timeout', async () => {
    vi.useFakeTimers();
    env.appleServicesId = 'svc.example.test';
    env.googleWebClientId = 'fixture-web.apps.googleusercontent.com';
    const auth = await load();
    const result = auth.prepare();
    scriptsFor(GOOGLE_SCRIPT)[0]?.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void result.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ apple: false, google: true });
  });
});

describe('the Apple button', () => {
  it('draws the container Apple JS reads', async () => {
    env.appleServicesId = 'svc.example.test';
    stubProviders();
    const auth = await load();
    const { getByTestId } = render(<auth.AppleSignInButton {...appleProps()} />);
    const node = getByTestId('auth.fixture-apple');
    expect(node.id).toBe('appleid-signin');
    expect(node.getAttribute('aria-label')).toBe('fixture-apple-label');
    expect(node.dataset).toMatchObject({
      mode: 'center-align',
      type: 'continue',
      color: 'white',
      border: 'true',
      width: '320',
      height: '44',
    });
  });

  it('Apple JS events map', async () => {
    env.appleServicesId = 'svc.example.test';
    const { appleInit } = stubProviders();
    const auth = await load();
    const props = appleProps();
    const { getByTestId, unmount } = render(<auth.AppleSignInButton {...props} />);
    expect(appleInit).toHaveBeenCalledWith({
      clientId: 'svc.example.test',
      scope: 'name email',
      redirectURI: window.location.origin + '/v1/auth/apple/callback',
      state: 's',
      nonce: 'h1',
      usePopup: true,
    });

    getByTestId('auth.fixture-apple').click();
    expect(onStart).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new CustomEvent('AppleIDSignInOnSuccess', {
        detail: {
          authorization: { id_token: 'fixture-id-token', code: 'fixture-code' },
          user: { name: { firstName: 'Fixture', lastName: 'Person' } },
        },
      }),
    );
    expect(onResult).toHaveBeenLastCalledWith({
      kind: 'token',
      idToken: 'fixture-id-token',
      code: 'fixture-code',
      name: { givenName: 'Fixture', familyName: 'Person' },
    });

    document.dispatchEvent(
      new CustomEvent('AppleIDSignInOnSuccess', {
        detail: { authorization: { id_token: 'fixture-id-token' } },
      }),
    );
    expect(onResult).toHaveBeenLastCalledWith({
      kind: 'token',
      idToken: 'fixture-id-token',
      code: null,
      name: null,
    });

    document.dispatchEvent(
      new CustomEvent('AppleIDSignInOnFailure', { detail: { error: 'popup_closed_by_user' } }),
    );
    expect(onResult).toHaveBeenLastCalledWith({ kind: 'cancelled' });

    document.dispatchEvent(
      new CustomEvent('AppleIDSignInOnFailure', {
        detail: { error: 'user_trigger_new_signin_flow' },
      }),
    );
    expect(onResult).toHaveBeenLastCalledWith({ kind: 'failed', code: 'auth.provider_error' });

    unmount();
    const calls = onResult.mock.calls.length;
    document.dispatchEvent(
      new CustomEvent('AppleIDSignInOnFailure', { detail: { error: 'popup_closed_by_user' } }),
    );
    expect(onResult).toHaveBeenCalledTimes(calls);
  });

  it('does nothing before the script exists', async () => {
    env.appleServicesId = 'svc.example.test';
    const auth = await load();
    const props = appleProps();
    const { getByTestId } = render(<auth.AppleSignInButton {...props} />);
    getByTestId('auth.fixture-apple').click();
    document.dispatchEvent(
      new CustomEvent('AppleIDSignInOnFailure', { detail: { error: 'popup_closed_by_user' } }),
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('the Google button', () => {
  it('Google callback maps', async () => {
    env.googleWebClientId = 'fixture-web.apps.googleusercontent.com';
    const { initialize, renderButton } = stubProviders();
    const auth = await load();
    const props = googleProps();
    const { getByTestId } = render(<auth.GoogleSignInButton {...props} />);
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'fixture-web.apps.googleusercontent.com',
        nonce: 'h1',
        auto_select: false,
        ux_mode: 'popup',
        context: 'signin',
        itp_support: true,
      }),
    );
    expect(renderButton).toHaveBeenCalledWith(
      getByTestId('auth.fixture-google'),
      expect.objectContaining({
        type: 'standard',
        theme: 'filled_black',
        shape: 'pill',
        size: 'large',
        text: 'continue_with',
        logo_alignment: 'left',
        width: 320,
      }),
    );

    renderButton.mock.calls[0]?.[1].click_listener();
    expect(onStart).toHaveBeenCalledTimes(1);

    const configuration = initialize.mock.calls[0]?.[0];
    configuration?.callback({ credential: 'fixture-id-token' });
    expect(onResult).toHaveBeenLastCalledWith({ kind: 'token', idToken: 'fixture-id-token' });
    configuration?.callback({ credential: '' });
    expect(onResult).toHaveBeenLastCalledWith({ kind: 'failed', code: 'auth.no_token' });
  });

  it('a disabled button takes no pointer events', async () => {
    env.googleWebClientId = 'fixture-web.apps.googleusercontent.com';
    stubProviders();
    const auth = await load();
    const { getByTestId } = render(
      <auth.GoogleSignInButton {...googleProps({ disabled: true })} />,
    );
    expect(getComputedStyle(getByTestId('auth.fixture-google')).pointerEvents).toBe('none');
  });
});

describe('both buttons', () => {
  it('re-initialises on a new nonce', async () => {
    env.appleServicesId = 'svc.example.test';
    env.googleWebClientId = 'fixture-web.apps.googleusercontent.com';
    const { appleInit, initialize, renderButton } = stubProviders();
    const auth = await load();
    const apple = appleProps();
    const google = googleProps();
    const view = render(
      <>
        <auth.AppleSignInButton {...apple} />
        <auth.GoogleSignInButton {...google} />
      </>,
    );
    expect(appleInit).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
    act(() => {
      view.rerender(
        <>
          <auth.AppleSignInButton {...apple} nonceHash="h2" />
          <auth.GoogleSignInButton {...google} nonceHash="h2" />
        </>,
      );
    });
    expect(appleInit).toHaveBeenCalledTimes(2);
    expect(appleInit).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: 'h2' }));
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: 'h2' }));
    expect(renderButton).toHaveBeenCalledTimes(2);
  });
});

describe('the provider slots', () => {
  it('are named groups, since an element with no role may carry no name', async () => {
    env.appleServicesId = 'svc.example.test';
    env.googleWebClientId = 'fixture-web.apps.googleusercontent.com';
    stubProviders();
    const auth = await load();
    const { getByTestId } = render(
      <>
        <auth.AppleSignInButton {...appleProps()} />
        <auth.GoogleSignInButton {...googleProps()} />
      </>,
    );
    for (const [testID, label] of [
      ['auth.fixture-apple', 'fixture-apple-label'],
      ['auth.fixture-google', 'fixture-google-label'],
    ] as const) {
      const node = getByTestId(testID);
      expect(node.getAttribute('role')).toBe('group');
      expect(node.getAttribute('aria-label')).toBe(label);
    }
  });
});

describe('clearProviderState', () => {
  it('turns off automatic choice when the script is there, and never rejects', async () => {
    const { disableAutoSelect } = stubProviders();
    const auth = await load();
    await expect(auth.clearProviderState()).resolves.toBeUndefined();
    expect(disableAutoSelect).toHaveBeenCalledTimes(1);
    disableAutoSelect.mockImplementation(() => {
      throw new Error('x');
    });
    await expect(auth.clearProviderState()).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    await expect(auth.clearProviderState()).resolves.toBeUndefined();
  });
});
