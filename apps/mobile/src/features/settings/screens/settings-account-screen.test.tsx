import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/settings/view-models/settings-account.fixtures';
import type { SettingsAccountViewModel } from '@/features/settings/view-models/settings-account.types';
import { renderWithProviders, setViewport } from '@/test/render';

import { SettingsAccountScreenView } from './settings-account-screen';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A drawing of the app loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing of the app loads no asset');
  },
}));

const FIXTURES: Readonly<Record<string, SettingsAccountViewModel>> = fixtures;
type Ready = Extract<SettingsAccountViewModel, { status: 'ready' }>;

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsAccountViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(<SettingsAccountScreenView vm={vm} />);
  return screen.getByTestId('settings.account');
}

/** A ready fixture with some of its data replaced. */
function withData(base: Ready, data: Partial<Ready['data']>): Ready {
  return { ...base, data: { ...base.data, ...data } };
}

/** A ready fixture with some of its profile replaced. */
function withMe(base: Ready, me: Partial<Ready['data']['me']>): Ready {
  return withData(base, { me: { ...base.data.me, ...me } });
}

function groupsOf(root: HTMLElement): (string | null)[] {
  return within(root)
    .getAllByRole('heading', { level: 2 })
    .map((group) => group.textContent);
}

describe('SettingsAccountScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(9);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(
        headings.map((heading) => heading.textContent),
        name,
      ).toEqual(['Email and sign-in']);
    }
  });

  it('email and methods', () => {
    const root = draw(fixtures.accountWithEmail);
    expect(groupsOf(root)).toEqual(['Email', 'How you sign in']);
    const email = screen.getByTestId('settings.account-email');
    expect(email.textContent).toBe('fixture@example.test');
    // The address is shown, not pressed: there is nothing to change it with yet.
    expect(email.getAttribute('role')).toBeNull();
    expect(screen.queryByTestId('settings.account-add-email')).toBeNull();
    expect(screen.getByTestId('settings.account-method-email').textContent).toBe('Email code');
    expect(screen.queryByTestId('settings.account-method-apple')).toBeNull();
    expect(screen.queryByTestId('settings.account-method-google')).toBeNull();
    expect(within(root).queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('auth.add-email-sheet')).toBeNull();

    // Every way of signing in the account has is named, in the order the account gives.
    const all = draw(
      withMe(fixtures.accountWithEmail, { signInMethods: ['google', 'apple', 'email'] }),
    );
    expect(
      [...all.querySelectorAll('[data-testid^="settings.account-method-"]')].map(
        (row) => row.textContent,
      ),
    ).toEqual(['Google', 'Apple', 'Email code']);
  });

  it('no email', () => {
    const onOpenAddEmail = vi.fn();
    const root = draw(withData(fixtures.accountNoEmail, { onOpenAddEmail }));
    expect(screen.queryByTestId('settings.account-email')).toBeNull();
    const row = screen.getByTestId('settings.account-add-email');
    expect(row.textContent).toBe('Add an email');
    expect(screen.getByRole('button', { name: 'Add an email' })).toBe(row);
    fireEvent.click(row);
    expect(onOpenAddEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('settings.account-method-apple').textContent).toBe('Apple');
    expect(root.textContent).not.toContain('Email code');

    // Without a connection the row says what it needs and takes no press.
    const waiting = vi.fn();
    draw({ ...withData(fixtures.accountNoEmail, { onOpenAddEmail: waiting }), stale: true });
    const offline = screen.getByTestId('settings.account-add-email');
    expect(offline.textContent).toBe('Add an emailNeeds a connection');
    expect(offline.getAttribute('role')).toBeNull();
    fireEvent.click(offline);
    expect(waiting).not.toHaveBeenCalled();
  });

  it('bouncing', () => {
    const root = draw(fixtures.accountEmailBounced);
    expect(within(root).getByRole('alert').textContent).toBe(
      'Email to this address is bouncing. Add another address or contact support.',
    );
    expect(
      within(draw(withMe(fixtures.accountWithEmail, { emailStatus: 'complained' }))).getByRole(
        'alert',
      ).textContent,
    ).toBe('Email to this address was marked as spam. Add another address or contact support.');
    expect(
      within(draw(withMe(fixtures.accountWithEmail, { emailStatus: 'disabled' }))).getByRole(
        'alert',
      ).textContent,
    ).toBe('We stopped sending email to this address. Add another address or contact support.');
  });

  it('the add-email sheet', () => {
    draw(fixtures.accountAddEmailCode);
    const sheet = screen.getByTestId('auth.add-email-sheet');
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent).toBe('Add an email');

    // Closing the sheet is the view-model's to do.
    const onCloseAddEmail = vi.fn();
    draw(withData(fixtures.accountAddEmailCode, { onCloseAddEmail }));
    fireEvent.click(screen.getByTestId('auth.add-email-sheet-grabber'));
    expect(onCloseAddEmail).toHaveBeenCalledTimes(1);
  });

  it('in use', () => {
    draw(fixtures.accountAddEmailInUse);
    const sheet = screen.getByTestId('auth.add-email-sheet');
    expect(sheet.textContent).toContain('That email belongs to another account.');
  });

  it('generic states', () => {
    const loading = draw(fixtures.accountLoading);
    expect(groupsOf(loading)).toEqual(['Email']);
    expect(loading.querySelectorAll('[role="progressbar"]')).toHaveLength(3);

    const onRetry = vi.fn();
    draw({ ...fixtures.accountError, onRetry });
    fireEvent.click(screen.getByTestId('settings.account-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    expect(draw(fixtures.accountOffline).textContent).toContain('No connection.');
    expect(draw(fixtures.accountStale).textContent).toContain(
      'No connection. This may be out of date.',
    );
  });
});
