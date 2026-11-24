import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type { AppleSignInButtonProps, GoogleSignInButtonProps } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = ['AppleSignInButton', 'GoogleSignInButton', 'clearProviderState', 'prepare'];

const BASE_PROPS_FIXTURE = {
  nonceHash: 'fixture-nonce-hash',
  appearance: {
    appleStyle: 'black',
    googleTheme: 'outline',
    googleShape: 'pill',
    googleSize: 'large',
    width: 280,
    height: 44,
  },
  disabled: false,
  onStart: () => undefined,
  testID: 'auth.fixture-button',
  accessibilityLabel: 'fixture-label',
} as const;

const appleProps: AppleSignInButtonProps = {
  ...BASE_PROPS_FIXTURE,
  state: 'fixture-state',
  onResult: () => undefined,
};

const googleProps: GoogleSignInButtonProps = {
  ...BASE_PROPS_FIXTURE,
  onResult: () => undefined,
};

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function expectNotReady(error: unknown, method: string): void {
  expect(error).toBeInstanceOf(PlatformNotReadyError);
  expect(error).toMatchObject({ module: 'auth', method, code: 'auth.not_ready' });
}

describe('auth stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.auth).sort();
    expect(nativeKeys).toEqual(Object.keys(web.auth).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.auth],
    ['index.web', web.auth],
  ])('%s', (_file, auth) => {
    it('capability flags are false', () => {
      const flags = Object.values(auth).filter((value) => typeof value === 'boolean');
      expect(flags).toEqual([]);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(await rejection(auth.prepare()), 'prepare');
      expectNotReady(await rejection(auth.clearProviderState()), 'clearProviderState');
    });

    it('components render nothing', () => {
      const { AppleSignInButton, GoogleSignInButton } = auth;

      const apple = render(<AppleSignInButton {...appleProps} />);
      expect(apple.container.childNodes).toHaveLength(0);
      apple.unmount();

      const google = render(<GoogleSignInButton {...googleProps} />);
      expect(google.container.childNodes).toHaveLength(0);
      google.unmount();
    });
  });
});
