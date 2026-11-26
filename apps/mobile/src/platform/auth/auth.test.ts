import { brandVariant } from '@citizenrun/shared';
import { isValidElement } from 'react';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';

import { appleAuthorizeUrl, appleReturnUrl } from './apple-redirect';
import type * as NativeIndex from './index.native';
import type {
  AppleSignInButtonProps,
  AppleSignInResult,
  Auth,
  GoogleSignInButtonProps,
  GoogleSignInResult,
  ProviderButtonAppearance,
} from './types';

const rn = vi.hoisted(() => ({
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  View: 'View',
}));
const env = vi.hoisted(() => ({
  appStoreUrl: null,
  playStoreUrl: null,
  googleIosClientId: null as string | null,
  googleWebClientId: null as string | null,
  appleServicesId: null as string | null,
}));
const origin = vi.hoisted(() => ({ value: 'http://api.test' }));
const apple = vi.hoisted(() => ({
  isAvailableAsync: vi.fn<() => Promise<boolean>>(),
  signInAsync: vi.fn<(options: unknown) => Promise<unknown>>(),
}));
const browser = vi.hoisted(() => ({
  openAuthSessionAsync: vi.fn<(url: string, redirect: string) => Promise<unknown>>(),
}));
const google = vi.hoisted(() => ({
  configure: vi.fn<(options: Record<string, unknown>) => void>(),
  presentExplicitSignIn: vi.fn<() => Promise<unknown>>(),
  signOut: vi.fn<() => Promise<void>>(),
}));

vi.mock('react-native', () => rn);
// The drawing library of Apple's button face on Android; its parts are plain names here.
vi.mock('react-native-svg', () => ({
  Svg: 'Svg',
  G: 'G',
  Path: 'Path',
  Rect: 'Rect',
  Text: 'SvgText',
}));
vi.mock('@/lib/env', () => ({ getAppEnv: () => env }));
vi.mock('@/platform/session', () => ({
  session: {
    get apiOrigin() {
      return origin.value;
    },
  },
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));
vi.mock('expo-apple-authentication', () => ({
  isAvailableAsync: apple.isAvailableAsync,
  signInAsync: apple.signInAsync,
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1, SIGN_UP: 2 },
  AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: browser.openAuthSessionAsync,
  WebBrowserResultType: {
    CANCEL: 'cancel',
    DISMISS: 'dismiss',
    OPENED: 'opened',
    LOCKED: 'locked',
  },
}));
vi.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: google,
  GoogleSignInButton: 'LibraryGoogleButton',
  GOOGLE_SIGN_IN_BUTTON_HEIGHT: 48,
  GOOGLE_SIGN_IN_BUTTON_WIDTH: { standard: 230, wide: 312, icon: 48 },
}));

const FIXTURE_WEB_ID = 'fixture-web.apps.googleusercontent.com';
const FIXTURE_IOS_ID = 'fixture-ios.apps.googleusercontent.com';
const FIXTURE_SERVICES_ID = 'svc.example.test';
const FIXTURE_CODE = 'c'.repeat(43);

const APPEARANCE: ProviderButtonAppearance = {
  appleStyle: 'black',
  googleTheme: 'outline',
  googleShape: 'rectangular',
  googleSize: 'large',
  width: 320,
  height: 44,
};

type Element = ReactElement<Record<string, unknown>>;

async function load(os: 'ios' | 'android'): Promise<Auth> {
  rn.Platform.OS = os;
  vi.resetModules();
  return (await vi.importActual<typeof NativeIndex>('./index.native')).auth;
}

/** Calls a function component the way React would, without a renderer (unit:mobile has no DOM). */
function renderOnce<P>(component: ComponentType<P>, props: P): Element | null {
  const result: unknown = (component as (props: P) => unknown)(props);
  return isValidElement<Record<string, unknown>>(result) ? result : null;
}

/** The first element in the tree, depth first, whose type is `type`. */
function find(element: Element | null, type: string): Element | null {
  if (element === null) {
    return null;
  }
  if (element.type === type) {
    return element;
  }
  const children: unknown = element.props['children'];
  for (const child of Array.isArray(children) ? children : [children]) {
    if (isValidElement<Record<string, unknown>>(child)) {
      const found = find(child, type);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

function press(element: Element | null): void {
  const onPress: unknown = element?.props['onPress'];
  if (typeof onPress !== 'function') {
    throw new Error('the element has no onPress');
  }
  (onPress as () => void)();
}

type Pending<R> = {
  onStart: Mock<() => void>;
  onResult: Mock<(result: R) => void>;
  result: Promise<R>;
};

function pending<R>(): Pending<R> {
  let resolve: (value: R) => void = () => undefined;
  const result = new Promise<R>((r) => {
    resolve = r;
  });
  return {
    onStart: vi.fn<() => void>(),
    onResult: vi.fn((value: R) => {
      resolve(value);
    }),
    result,
  };
}

function appleProps(p: Pending<AppleSignInResult>, nonceHash = 'h'): AppleSignInButtonProps {
  return {
    nonceHash,
    state: 's',
    appearance: APPEARANCE,
    disabled: false,
    onStart: p.onStart,
    onResult: p.onResult,
    testID: 'auth.fixture-apple',
    accessibilityLabel: 'fixture-apple-label',
  };
}

function googleProps(p: Pending<GoogleSignInResult>, nonceHash = 'h'): GoogleSignInButtonProps {
  return {
    nonceHash,
    appearance: APPEARANCE,
    disabled: false,
    onStart: p.onStart,
    onResult: p.onResult,
    testID: 'auth.fixture-google',
    accessibilityLabel: 'fixture-google-label',
  };
}

async function pressApple(
  auth: Auth,
  os: 'ios' | 'android',
): Promise<{ result: AppleSignInResult; p: Pending<AppleSignInResult> }> {
  const p = pending<AppleSignInResult>();
  const tree = renderOnce(auth.AppleSignInButton, appleProps(p));
  press(find(tree, os === 'ios' ? 'AppleAuthenticationButton' : 'Pressable'));
  return { result: await p.result, p };
}

async function pressGoogle(auth: Auth, nonceHash = 'h'): Promise<GoogleSignInResult> {
  const p = pending<GoogleSignInResult>();
  press(
    find(renderOnce(auth.GoogleSignInButton, googleProps(p, nonceHash)), 'LibraryGoogleButton'),
  );
  return p.result;
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  env.googleIosClientId = null;
  env.googleWebClientId = null;
  env.appleServicesId = null;
  origin.value = 'http://api.test';
  for (const fn of [
    apple.isAvailableAsync,
    apple.signInAsync,
    browser.openAuthSessionAsync,
    google.configure,
    google.presentExplicitSignIn,
    google.signOut,
  ]) {
    fn.mockReset();
  }
  apple.isAvailableAsync.mockResolvedValue(true);
  google.signOut.mockResolvedValue(undefined);
  consoleSpies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
});

describe('Apple on iOS', () => {
  it('draws the system button with the chosen style', async () => {
    const auth = await load('ios');
    const p = pending<AppleSignInResult>();
    const tree = renderOnce(auth.AppleSignInButton, { ...appleProps(p), disabled: true });
    expect(tree?.props).toMatchObject({
      testID: 'auth.fixture-apple',
      accessibilityLabel: 'fixture-apple-label',
      pointerEvents: 'none',
    });
    expect(find(tree, 'AppleAuthenticationButton')?.props).toMatchObject({
      buttonType: 1,
      buttonStyle: 2,
      style: { width: 320, height: 44 },
    });
  });

  it('iOS name only when given', async () => {
    apple.signInAsync.mockResolvedValue({
      identityToken: 'fixture-id-token',
      authorizationCode: null,
      fullName: { givenName: null, familyName: null },
    });
    const auth = await load('ios');
    const { result } = await pressApple(auth, 'ios');
    expect(result).toEqual({ kind: 'token', idToken: 'fixture-id-token', code: null, name: null });
    expect(apple.signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce: 'h' });

    apple.signInAsync.mockResolvedValue({
      identityToken: 'fixture-id-token',
      authorizationCode: 'fixture-code',
      fullName: { givenName: 'Fixture', familyName: null },
    });
    expect((await pressApple(auth, 'ios')).result).toEqual({
      kind: 'token',
      idToken: 'fixture-id-token',
      code: 'fixture-code',
      name: { givenName: 'Fixture', familyName: null },
    });
  });

  it('iOS cancel', async () => {
    apple.signInAsync.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    const auth = await load('ios');
    const { result, p } = await pressApple(auth, 'ios');
    expect(result).toEqual({ kind: 'cancelled' });
    expect(p.onStart).toHaveBeenCalledTimes(1);
    expect(p.onStart.mock.invocationCallOrder[0]).toBeLessThan(
      p.onResult.mock.invocationCallOrder[0] ?? 0,
    );
    expect(p.onStart.mock.invocationCallOrder[0]).toBeLessThan(
      apple.signInAsync.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('iOS missing token', async () => {
    apple.signInAsync.mockResolvedValue({
      identityToken: null,
      authorizationCode: null,
      fullName: null,
    });
    const auth = await load('ios');
    expect((await pressApple(auth, 'ios')).result).toEqual({
      kind: 'failed',
      code: 'auth.no_token',
    });
  });

  it('any other library error is a provider error', async () => {
    apple.signInAsync.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'ERR_REQUEST_FAILED' }),
    );
    const auth = await load('ios');
    expect((await pressApple(auth, 'ios')).result).toEqual({
      kind: 'failed',
      code: 'auth.provider_error',
    });
  });

  it('a throwing availability check answers false', async () => {
    apple.isAvailableAsync.mockRejectedValue(new Error('x'));
    const auth = await load('ios');
    expect(await auth.prepare()).toEqual({ apple: false, google: false });
  });
});

describe('Apple on Android', () => {
  it('Android Apple off without the Services ID or https', async () => {
    origin.value = 'https://api.example.test';
    expect(await (await load('android')).prepare()).toMatchObject({ apple: false });

    env.appleServicesId = FIXTURE_SERVICES_ID;
    origin.value = 'http://10.0.2.2:8080';
    expect(await (await load('android')).prepare()).toMatchObject({ apple: false });

    origin.value = 'https://api.example.test';
    expect(await (await load('android')).prepare()).toMatchObject({ apple: true });
    expect(apple.isAvailableAsync).not.toHaveBeenCalled();
  });

  it('draws an accessible button that holds the face', async () => {
    const auth = await load('android');
    const p = pending<AppleSignInResult>();
    const tree = renderOnce(auth.AppleSignInButton, { ...appleProps(p), disabled: true });
    expect(tree?.type).toBe('Pressable');
    expect(tree?.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'fixture-apple-label',
      accessibilityState: { disabled: true },
      disabled: true,
      testID: 'auth.fixture-apple',
      style: { width: 320, height: 44 },
    });
  });

  it('Android Apple flow', async () => {
    env.appleServicesId = FIXTURE_SERVICES_ID;
    origin.value = 'https://api.example.test';
    const scheme = brandVariant('development').scheme;
    browser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: `${appleReturnUrl(scheme)}?code=${FIXTURE_CODE}&state=s`,
    });
    const auth = await load('android');
    const { result, p } = await pressApple(auth, 'android');
    expect(browser.openAuthSessionAsync).toHaveBeenCalledWith(
      appleAuthorizeUrl({
        servicesId: FIXTURE_SERVICES_ID,
        apiOrigin: 'https://api.example.test',
        state: 's',
        nonceHash: 'h',
      }),
      appleReturnUrl(scheme),
    );
    expect(result).toEqual({ kind: 'handoff', code: FIXTURE_CODE });
    expect(p.onStart).toHaveBeenCalledTimes(1);
  });

  it('a closed browser and a thrown error map', async () => {
    env.appleServicesId = FIXTURE_SERVICES_ID;
    origin.value = 'https://api.example.test';
    const auth = await load('android');
    browser.openAuthSessionAsync.mockResolvedValue({ type: 'dismiss' });
    expect((await pressApple(auth, 'android')).result).toEqual({ kind: 'cancelled' });
    browser.openAuthSessionAsync.mockRejectedValue(new Error('x'));
    expect((await pressApple(auth, 'android')).result).toEqual({
      kind: 'failed',
      code: 'auth.provider_error',
    });
  });

  it('a press without the Services ID is not configured', async () => {
    const auth = await load('android');
    expect((await pressApple(auth, 'android')).result).toEqual({
      kind: 'failed',
      code: 'auth.not_configured',
    });
    expect(browser.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});

describe('Google on phones', () => {
  it('Google off without ids', async () => {
    for (const os of ['ios', 'android'] as const) {
      const auth = await load(os);
      expect(await auth.prepare()).toMatchObject({ google: false });
      const p = pending<GoogleSignInResult>();
      expect(renderOnce(auth.GoogleSignInButton, googleProps(p))).toBeNull();
    }
    expect(google.configure).not.toHaveBeenCalled();
  });

  it('Google on iOS needs both ids', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    expect(await (await load('ios')).prepare()).toMatchObject({ google: false });
    expect(google.configure).not.toHaveBeenCalled();

    expect(await (await load('android')).prepare()).toMatchObject({ google: true });
    expect(google.configure).toHaveBeenLastCalledWith({
      webClientId: FIXTURE_WEB_ID,
      scopes: ['email', 'profile'],
      autoSelectOnSignIn: false,
      offlineAccess: false,
    });

    env.googleIosClientId = FIXTURE_IOS_ID;
    expect(await (await load('ios')).prepare()).toMatchObject({ google: true });
    expect(google.configure).toHaveBeenLastCalledWith({
      webClientId: FIXTURE_WEB_ID,
      iosClientId: FIXTURE_IOS_ID,
      scopes: ['email', 'profile'],
      autoSelectOnSignIn: false,
      offlineAccess: false,
    });
  });

  it('draws the library button in the chosen scheme and size', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    const auth = await load('android');
    await auth.prepare();
    const p = pending<GoogleSignInResult>();
    const wide = renderOnce(auth.GoogleSignInButton, { ...googleProps(p), disabled: true });
    expect(wide?.props).toMatchObject({
      signInBehavior: 'none',
      colorScheme: 'light',
      size: 'wide',
      style: { width: 320, height: 48 },
      disabled: true,
      testID: 'auth.fixture-google',
      accessibilityLabel: 'fixture-google-label',
    });
    const narrow = renderOnce(auth.GoogleSignInButton, {
      ...googleProps(p),
      appearance: { ...APPEARANCE, googleTheme: 'filled_black' as const, width: 280 },
    });
    expect(narrow?.props).toMatchObject({ colorScheme: 'dark', size: 'standard' });
  });

  it('Google configures with the nonce before signing in', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    google.presentExplicitSignIn.mockResolvedValue({ type: 'cancelled', data: null });
    const auth = await load('android');
    await auth.prepare();
    google.configure.mockClear();

    await pressGoogle(auth, 'h1');
    expect(google.configure).toHaveBeenCalledTimes(1);
    expect(google.configure).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: 'h1' }));
    expect(google.configure.mock.invocationCallOrder[0]).toBeLessThan(
      google.presentExplicitSignIn.mock.invocationCallOrder[0] ?? 0,
    );

    await pressGoogle(auth, 'h2');
    expect(google.configure).toHaveBeenCalledTimes(2);
    expect(google.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ webClientId: FIXTURE_WEB_ID, nonce: 'h2' }),
    );
    expect(google.presentExplicitSignIn).toHaveBeenCalledTimes(2);

    await pressGoogle(auth, 'h2');
    expect(google.configure).toHaveBeenCalledTimes(2);
  });

  it('Google results map', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    const auth = await load('android');
    await auth.prepare();
    const user = {
      id: 'x',
      email: null,
      name: null,
      givenName: null,
      familyName: null,
      photo: null,
    };
    const cases: [() => void, GoogleSignInResult][] = [
      [
        () =>
          google.presentExplicitSignIn.mockResolvedValue({
            type: 'success',
            data: { user, scopes: [], idToken: 'fixture-id-token', serverAuthCode: null },
          }),
        { kind: 'token', idToken: 'fixture-id-token' },
      ],
      [
        () =>
          google.presentExplicitSignIn.mockResolvedValue({
            type: 'success',
            data: { user, scopes: [], idToken: '', serverAuthCode: null },
          }),
        { kind: 'failed', code: 'auth.no_token' },
      ],
      [
        () => google.presentExplicitSignIn.mockResolvedValue({ type: 'cancelled', data: null }),
        { kind: 'cancelled' },
      ],
      [
        () =>
          google.presentExplicitSignIn.mockResolvedValue({
            type: 'noSavedCredentialFound',
            data: null,
          }),
        { kind: 'failed', code: 'auth.no_token' },
      ],
      [
        () => google.presentExplicitSignIn.mockRejectedValue(new Error('[DEVELOPER_ERROR] x')),
        { kind: 'failed', code: 'auth.provider_error' },
      ],
    ];
    for (const [script, expected] of cases) {
      script();
      expect(await pressGoogle(auth)).toEqual(expected);
    }
  });

  it('a button mounted before prepare() answers is drawn and configures on its press', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    google.presentExplicitSignIn.mockResolvedValue({ type: 'cancelled', data: null });
    const auth = await load('android');
    const p = pending<GoogleSignInResult>();
    const tree = renderOnce(auth.GoogleSignInButton, googleProps(p, 'h1'));
    expect(tree?.type).toBe('LibraryGoogleButton');
    press(tree);
    expect(await p.result).toEqual({ kind: 'cancelled' });
    expect(google.configure).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'h1' }));
    await expect(auth.clearProviderState()).resolves.toBeUndefined();
    expect(google.signOut).toHaveBeenCalledTimes(1);
  });

  it('a failing configuration is unavailable', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    google.configure.mockImplementation(() => {
      throw new Error('x');
    });
    const auth = await load('android');
    expect(await auth.prepare()).toMatchObject({ google: false });
    const p = pending<GoogleSignInResult>();
    expect(renderOnce(auth.GoogleSignInButton, googleProps(p))).toBeNull();
  });
});

describe('the module', () => {
  it('prepare is idempotent', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    env.googleIosClientId = FIXTURE_IOS_ID;
    const auth = await load('ios');
    const first = auth.prepare();
    const second = auth.prepare();
    expect(second).toBe(first);
    expect(await first).toEqual({ apple: true, google: true });
    expect(await auth.prepare()).toEqual({ apple: true, google: true });
    expect(apple.isAvailableAsync).toHaveBeenCalledTimes(1);
    expect(google.configure).toHaveBeenCalledTimes(1);
  });

  it('clearProviderState never rejects', async () => {
    env.googleWebClientId = FIXTURE_WEB_ID;
    google.signOut.mockRejectedValue(new Error('x'));
    const auth = await load('android');
    await auth.prepare();
    await expect(auth.clearProviderState()).resolves.toBeUndefined();
    expect(google.signOut).toHaveBeenCalledTimes(1);
  });

  it('clearProviderState leaves an unconfigured library alone', async () => {
    const auth = await load('android');
    await auth.prepare();
    await expect(auth.clearProviderState()).resolves.toBeUndefined();
    expect(google.signOut).not.toHaveBeenCalled();
  });
});
