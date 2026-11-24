import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { systemError } from '@/features/system/view-models/system-error.fixtures';
import type { SystemErrorViewModel } from '@/features/system/view-models/system-error.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { SystemErrorScreenView } from './system-error-screen';

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

const COMPACT = [390, 844] as const;
const VIEWPORTS = [[360, 740], COMPACT, [820, 1180], [1440, 900]] as const;

type Viewport = readonly [width: number, height: number];

function sized(viewport: Viewport): void {
  setViewport(viewport[0], viewport[1]);
}

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SystemErrorViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<SystemErrorScreenView vm={vm} />, options);
  return screen.getByTestId('system.error');
}

describe('SystemErrorScreenView', () => {
  it('renders', () => {
    for (const viewport of VIEWPORTS) {
      sized(viewport);
      for (const theme of ['light', 'dark'] as const) {
        const root = draw(systemError, { theme });
        expect(root.textContent).not.toContain('{{');
        const titles = screen.getAllByRole('heading', { level: 1 });
        expect(titles.map((title) => title.textContent)).toEqual(['Something went wrong.']);
        expect(
          within(root).getByText('Try again. If it keeps happening, update the app.'),
        ).toBeTruthy();
      }
    }
  });

  it('Try again calls onRetry', () => {
    sized(COMPACT);
    const onRetry = vi.fn<() => void>();
    const root = draw({ onRetry });
    const retry = screen.getByTestId('system.error-retry');
    expect(retry.textContent).toBe('Try again');
    // The one control of the screen.
    expect([...root.querySelectorAll('a, button, [role="button"], [role="link"]')]).toEqual([
      retry,
    ]);
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
