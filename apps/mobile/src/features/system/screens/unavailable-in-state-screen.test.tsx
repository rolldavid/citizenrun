import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/system/view-models/state-unavailable.fixtures';
import type { StateUnavailableViewModel } from '@/features/system/view-models/state-unavailable.types';
import { getI18n } from '@/lib/i18n';
import type * as Navigation from '@/lib/navigation';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { UnavailableInStateScreenView } from './unavailable-in-state-screen';

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

// Where the screen's two buttons lead is the view-model's; the test stands in for the router.
const navigation = vi.hoisted(() => ({ navigateTo: vi.fn<(path: string) => void>() }));

vi.mock('@/lib/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof Navigation>()),
  navigateTo: navigation.navigateTo,
}));

const FIXTURES: Readonly<Record<string, StateUnavailableViewModel>> = fixtures;
const BODY = 'You can still read public office and candidate pages.';

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(
  vm: StateUnavailableViewModel,
  options: RenderWithProvidersOptions = {},
): HTMLElement {
  cleanup();
  renderWithProviders(<UnavailableInStateScreenView vm={vm} />, options);
  return screen.getByTestId('system.state-unavailable');
}

function title(): string {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  return headings[0]?.textContent ?? '';
}

beforeEach(() => {
  navigation.navigateTo.mockClear();
});

describe('UnavailableInStateScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      ['stateUnavailableGeneric', 'stateUnavailableNamed'].sort(),
    );
    for (const [width, height] of [
      [360, 740],
      [430, 932],
      [820, 1180],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        for (const theme of ['light', 'dark'] as const) {
          const root = draw(vm, { theme });
          expect(root.textContent, name).not.toContain('{{');
          expect(within(root).getByText(BODY), name).toBeTruthy();
        }
      }
    }
    setViewport(390, 844);
  });

  it('named and generic', () => {
    draw(fixtures.stateUnavailableNamed);
    const named = title();
    // The state's name comes from its code.
    expect(fixtures.stateUnavailableNamed.stateCode).toBe('VT');
    expect(named).toMatch(/^.+ is not available in Vermont yet\.$/);
    expect(named).toBe(getI18n().t('system:stateUnavailable.title', { state: 'Vermont' }));

    draw({ ...fixtures.stateUnavailableNamed, stateCode: 'DC' });
    expect(title()).toMatch(/ is not available in District of Columbia yet\.$/);

    draw(fixtures.stateUnavailableGeneric);
    const generic = title();
    expect(generic).toMatch(/^.+ is not available where you live yet\.$/);
    expect(generic).toBe(getI18n().t('system:stateUnavailable.titleGeneric'));

    // A code that names no state is not printed as if it were a name.
    draw({ ...fixtures.stateUnavailableNamed, stateCode: 'ZZ' });
    expect(title()).toBe(generic);
  });

  it('actions', () => {
    const signedOut = draw(fixtures.stateUnavailableNamed);
    const browse = screen.getByTestId('system.state-unavailable-browse');
    expect(screen.getByRole('button', { name: 'Browse offices' })).toBe(browse);
    // Signed out there is no account to delete.
    expect(screen.queryByTestId('system.state-unavailable-delete')).toBeNull();
    expect([...signedOut.querySelectorAll('a, button, [role="button"], [role="link"]')]).toEqual([
      browse,
    ]);
    expect(navigation.navigateTo).not.toHaveBeenCalled();
    fireEvent.click(browse);
    expect(navigation.navigateTo.mock.calls).toEqual([['/']]);

    navigation.navigateTo.mockClear();
    const signedIn = draw(fixtures.stateUnavailableGeneric);
    const remove = screen.getByTestId('system.state-unavailable-delete');
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBe(remove);
    expect([...signedIn.querySelectorAll('a, button, [role="button"], [role="link"]')]).toEqual([
      screen.getByTestId('system.state-unavailable-browse'),
      remove,
    ]);
    fireEvent.click(remove);
    expect(navigation.navigateTo.mock.calls).toEqual([['/settings/delete-account']]);
    navigation.navigateTo.mockClear();
    fireEvent.click(screen.getByTestId('system.state-unavailable-browse'));
    expect(navigation.navigateTo.mock.calls).toEqual([['/']]);

    // Signed in with nowhere to delete from, or a path with no session: no Delete either way.
    draw({ ...fixtures.stateUnavailableGeneric, deleteHref: null });
    expect(screen.queryByTestId('system.state-unavailable-delete')).toBeNull();
    draw({ ...fixtures.stateUnavailableGeneric, signedIn: false });
    expect(screen.queryByTestId('system.state-unavailable-delete')).toBeNull();
  });
});
