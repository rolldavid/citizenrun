import { cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/system/view-models/root.fixtures';
import type { NavItem, RootViewModel } from '@/features/system/view-models/root.types';
import { renderWithProviders, setViewport } from '@/test/render';

import { RootLayoutScreenView } from './root-layout-screen';
import { RootTabBar } from './root-tab-bar';

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

const TABS = ['Home', 'Explore', 'Post', 'Activity', 'Profile'];

/** The bar where the tab navigator draws it: inside the root layout, with that layout's values. */
function draw(vm: RootViewModel): void {
  cleanup();
  renderWithProviders(
    <RootLayoutScreenView vm={vm} systemScreen={null} overlay={null}>
      <RootTabBar />
    </RootLayoutScreenView>,
  );
}

function tabs(): HTMLElement[] {
  return screen.getAllByRole('link').filter((link) => {
    return (link.getAttribute('data-testid') ?? '').startsWith('shell.tab-');
  });
}

describe('RootTabBar', () => {
  it('compact draws five items', () => {
    setViewport(390, 844);
    const onNavigate = vi.fn<(item: NavItem) => void>();
    const onReselect = vi.fn<(item: NavItem) => void>();
    draw({ ...fixtures.rootSignedIn, onNavigate, onReselect });

    expect(tabs().map((tab) => tab.getAttribute('aria-label'))).toEqual(TABS);
    for (const name of TABS) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
    const home = screen.getByRole('link', { name: 'Home' });
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(tabs().filter((tab) => tab.getAttribute('aria-current') !== null)).toEqual([home]);

    fireEvent.click(screen.getByRole('link', { name: 'Profile' }));
    expect(onNavigate.mock.calls).toEqual([['profile']]);
    expect(onReselect).not.toHaveBeenCalled();

    fireEvent.click(home);
    expect(onReselect.mock.calls).toEqual([['home']]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('shows the item and the count the root layout holds', () => {
    setViewport(390, 844);
    draw({
      ...fixtures.rootSignedIn,
      shell: {
        ...fixtures.rootSignedIn.shell,
        active: 'profile',
        unread: { messages: 0, activity: 2 },
      },
    });
    expect(screen.getByTestId('shell.tab-profile').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('shell.tab-home').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('shell.tab-activity').getAttribute('aria-label')).toContain('2');

    // A pushed route with no tab under it: Home stands as the active item.
    draw({
      ...fixtures.rootSignedIn,
      shell: { ...fixtures.rootSignedIn.shell, active: null },
    });
    expect(screen.getByTestId('shell.tab-home').getAttribute('aria-current')).toBe('page');
  });

  it('no tab bar on the rail shells', () => {
    for (const [width, height] of [
      [820, 1180],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      draw(fixtures.rootSignedIn);
      expect(tabs()).toEqual([]);
      expect(screen.queryByTestId('shell.tab-home')).toBeNull();
      // The rail is the one navigation there.
      expect(screen.getAllByRole('navigation')).toHaveLength(1);
      expect(screen.getByTestId('shell.rail')).toBeTruthy();
      expect(screen.getByRole('main').textContent).toBe('');
    }
    setViewport(390, 844);
  });
});
