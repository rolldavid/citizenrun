import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/settings/view-models/settings.fixtures';
import type { SettingsViewModel } from '@/features/settings/view-models/settings.types';
import { renderWithProviders, setViewport } from '@/test/render';
import { color } from '@/ui/tokens';

import { SettingsScreenView } from './settings-screen';

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

const FIXTURES: Readonly<Record<string, SettingsViewModel>> = fixtures;
type SettingsData = Extract<SettingsViewModel, { status: 'ready' }>['data'];

const GROUPS = ['Your account', 'Alerts', 'Privacy and safety', 'Look', 'Your data', 'About'];
const ROWS = [
  'settings.row-profile',
  'settings.row-issues',
  'settings.row-account',
  'settings.row-notifications',
  'settings.row-privacy',
  'settings.row-appearance',
  'settings.row-export',
  'settings.row-delete-account',
  'settings.row-about',
  'settings.row-terms',
  'settings.row-privacy-policy',
  'settings.row-content-policy',
];

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SettingsViewModel): HTMLElement {
  cleanup();
  setViewport(390, 844);
  renderWithProviders(<SettingsScreenView vm={vm} />);
  return screen.getByTestId('settings');
}

/** The default fixture with some of its data replaced. */
function withData(data: Partial<SettingsData>): SettingsViewModel {
  return { ...fixtures.settingsDefault, data: { ...fixtures.settingsDefault.data, ...data } };
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** The ids of the rows drawn, in the order they are drawn. */
function rowIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-testid^="settings.row-"]')].map(
    (row) => row.getAttribute('data-testid') ?? '',
  );
}

describe('SettingsScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(7);
    for (const [name, vm] of Object.entries(FIXTURES)) {
      const root = draw(vm);
      expect(root.textContent, name).not.toContain('{{');
      const headings = within(root).getAllByRole('heading', { level: 1 });
      expect(headings, name).toHaveLength(1);
      expect(headings[0]?.textContent, name).toBe('Settings');
    }
  });

  it('rows in order', () => {
    const root = draw(fixtures.settingsDefault);
    const groups = within(root).getAllByRole('heading', { level: 2 });
    expect(groups.map((group) => group.textContent)).toEqual(GROUPS);
    expect(rowIds(root)).toEqual(ROWS);

    // Each navigation row is a link to its screen.
    expect(screen.getByRole('link', { name: 'Edit profile' }).getAttribute('href')).toBe(
      '/settings/profile',
    );
    expect(screen.getByRole('link', { name: 'Your issues' }).getAttribute('href')).toBe(
      '/settings/issues',
    );
    expect(screen.getByRole('link', { name: 'Delete account' }).getAttribute('href')).toBe(
      '/settings/delete-account',
    );

    // Delete account, and no other row, is in the danger tone.
    const danger = written(color.light.danger);
    const dangerTitles = ROWS.filter((id) => {
      const title = within(screen.getByTestId(id)).getAllByText(/./)[0];
      return title?.style.color === danger;
    });
    expect(dangerTitles).toEqual(['settings.row-delete-account']);

    expect(root.textContent).toContain('Version 1.0.0');
  });

  it('notifications is not pressable', () => {
    draw(fixtures.settingsDefault);
    const row = screen.getByTestId('settings.row-notifications');
    expect(row.textContent).toBe('Notifications Soon');
    expect(row.getAttribute('role')).toBeNull();
    expect(row.tagName).not.toBe('A');
    expect(row.querySelector('a, button, [role="button"], [role="link"]')).toBeNull();
    expect(row.closest('a, button, [role="button"], [role="link"]')).toBeNull();
  });

  it('legal rows open the URLs', () => {
    const onOpenLegal = vi.fn();
    draw(withData({ onOpenLegal }));
    const { legal } = fixtures.settingsDefault.data;

    fireEvent.click(screen.getByTestId('settings.row-terms'));
    expect(onOpenLegal).toHaveBeenLastCalledWith(legal.terms);
    fireEvent.click(screen.getByTestId('settings.row-privacy-policy'));
    expect(onOpenLegal).toHaveBeenLastCalledWith(legal.privacyPolicy);
    fireEvent.click(screen.getByTestId('settings.row-content-policy'));
    expect(onOpenLegal).toHaveBeenLastCalledWith(legal.contentPolicy);
    expect(onOpenLegal).toHaveBeenCalledTimes(3);
  });

  it('log out', () => {
    const onLogout = vi.fn();
    draw(withData({ onLogout }));
    const button = screen.getByTestId('settings.logout');
    expect(button.textContent).toBe('Log out');
    expect(button.getAttribute('aria-busy')).not.toBe('true');
    fireEvent.click(button);
    expect(onLogout).toHaveBeenCalledTimes(1);

    // While the request is on its way the button waits and takes no press.
    const waiting = vi.fn();
    draw({
      ...fixtures.settingsLoggingOut,
      data: { ...fixtures.settingsLoggingOut.data, onLogout: waiting },
    });
    const busy = screen.getByTestId('settings.logout');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(busy);
    expect(waiting).not.toHaveBeenCalled();
  });

  it('support only with an address', () => {
    draw(fixtures.settingsDefault);
    expect(screen.queryByTestId('settings.row-support')).toBeNull();

    const onContactSupport = vi.fn();
    const root = draw({
      ...fixtures.settingsSupport,
      data: { ...fixtures.settingsSupport.data, onContactSupport },
    });
    expect(rowIds(root)).toEqual([...ROWS, 'settings.row-support']);
    const row = screen.getByTestId('settings.row-support');
    expect(row.textContent).toBe('Contact support');
    fireEvent.click(row);
    expect(onContactSupport).toHaveBeenCalledTimes(1);
  });

  it('appearance shows the choice', () => {
    draw(fixtures.settingsDefault);
    expect(screen.getByTestId('settings.row-appearance').textContent).toBe(
      'Appearance Match my device',
    );
    draw(withData({ themeChoice: 'dark' }));
    expect(screen.getByTestId('settings.row-appearance').textContent).toBe('Appearance Dark');
    draw(withData({ themeChoice: 'light' }));
    expect(screen.getByTestId('settings.row-appearance').textContent).toBe('Appearance Light');
  });

  it('generic states', () => {
    // Loading: the first group's header over three rows, of which a screen reader meets one.
    const loading = draw(fixtures.settingsLoading);
    expect(
      within(loading)
        .getAllByRole('heading', { level: 2 })
        .map((group) => group.textContent),
    ).toEqual(['Your account']);
    expect(loading.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(within(loading).getAllByRole('progressbar')).toHaveLength(1);
    expect(rowIds(loading)).toEqual([]);

    // An error says what happened and offers the retry.
    const onRetry = vi.fn();
    const failed = draw({ ...fixtures.settingsError, onRetry });
    expect(failed.textContent).toContain("This didn't load.");
    expect(failed.textContent).toContain('Something went wrong on our side. Try again.');
    fireEvent.click(screen.getByTestId('settings-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    const again = vi.fn();
    const offline = draw({ ...fixtures.settingsOffline, onRetry: again });
    expect(offline.textContent).toContain('No connection.');
    fireEvent.click(screen.getByTestId('settings-retry'));
    expect(again).toHaveBeenCalledTimes(1);

    // Shown from the cache: the rows, under the line that says so.
    const stale = draw(fixtures.settingsStale);
    expect(stale.textContent).toContain('No connection. This may be out of date.');
    expect(rowIds(stale)).toEqual(ROWS);
  });
});
