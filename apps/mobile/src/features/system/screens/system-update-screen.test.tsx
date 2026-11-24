import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/system/view-models/system-update.fixtures';
import type { SystemUpdateViewModel } from '@/features/system/view-models/system-update.types';
import { getI18n } from '@/lib/i18n';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { SystemUpdateScreenView } from './system-update-screen';

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

const FIXTURES = {
  updateWithStore: fixtures.updateWithStore,
  updateNoStore: fixtures.updateNoStore,
} satisfies Record<string, SystemUpdateViewModel>;
const DRAWN: readonly SystemUpdateViewModel[] = Object.values(FIXTURES);

const COMPACT = [390, 844] as const;
const VIEWPORTS = [[360, 740], COMPACT, [820, 1180], [1440, 900]] as const;

type Viewport = readonly [width: number, height: number];

function sized(viewport: Viewport): void {
  setViewport(viewport[0], viewport[1]);
}

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SystemUpdateViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<SystemUpdateScreenView vm={vm} />, options);
  return screen.getByTestId('system.update');
}

/** Everything a person could press. */
function controlsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a, button, [role="button"], [role="link"]')];
}

describe('SystemUpdateScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(fixtures).sort()).toEqual(Object.keys(FIXTURES).sort());
    for (const viewport of VIEWPORTS) {
      sized(viewport);
      for (const vm of DRAWN) {
        for (const theme of ['light', 'dark'] as const) {
          const root = draw(vm, { theme });
          expect(root.textContent).not.toContain('{{');
        }
      }
    }
  });

  it('with a store it offers Update', () => {
    sized(COMPACT);
    const onOpenStore = vi.fn<() => void>();
    const root = draw({ storeSupported: true, onOpenStore });
    expect(
      within(root).getByText('This version is too old to work with the service.'),
    ).toBeTruthy();
    const action = screen.getByTestId('system.update-action');
    expect(action.textContent).toBe('Update');
    expect(controlsOf(root)).toEqual([action]);
    fireEvent.click(action);
    expect(onOpenStore).toHaveBeenCalledTimes(1);
  });

  it('without a store it says to reopen the app and offers nothing', () => {
    sized(COMPACT);
    const onOpenStore = vi.fn<() => void>();
    const root = draw({ storeSupported: false, onOpenStore });
    const body = getI18n().t('system:update.bodyNoStore');
    expect(body).toMatch(/^Close .+ and open it again in a few minutes\.$/);
    expect(within(root).getByText(body)).toBeTruthy();
    expect(
      within(root).queryByText('This version is too old to work with the service.'),
    ).toBeNull();
    expect(screen.queryByTestId('system.update-action')).toBeNull();
    expect(controlsOf(root)).toEqual([]);
    expect(onOpenStore).not.toHaveBeenCalled();
  });

  it('has a level 1 title and no dismiss control', () => {
    sized(COMPACT);
    for (const vm of DRAWN) {
      const root = draw(vm);
      const title = getI18n().t('system:update.title');
      expect(title).toMatch(/^Update .+ to keep going\.$/);
      const titles = screen.getAllByRole('heading', { level: 1 });
      expect(titles.map((heading) => heading.textContent)).toEqual([title]);
      expect(document.activeElement).toBe(titles[0]);
      // Nothing closes the screen: the one control, where there is one, is Update.
      expect(controlsOf(root).map((control) => control.getAttribute('data-testid'))).toEqual(
        vm.storeSupported ? ['system.update-action'] : [],
      );
      expect(within(root).queryByLabelText('Close')).toBeNull();
    }
  });
});
