import { cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/system/view-models/adults-only.fixtures';
import type { AdultsOnlyViewModel } from '@/features/system/view-models/adults-only.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { AdultsOnlyScreenView } from './adults-only-screen';

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

const FIXTURES: Readonly<Record<string, AdultsOnlyViewModel>> = fixtures;
const TITLE = 'This app is for adults.';

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: AdultsOnlyViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<AdultsOnlyScreenView vm={vm} />, options);
  return screen.getByTestId('system.adults-only');
}

describe('AdultsOnlyScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toEqual(['adultsOnly']);
    for (const [width, height] of [
      [360, 740],
      [430, 932],
      [820, 1180],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        for (const theme of ['light', 'dark'] as const) {
          expect(draw(vm, { theme }).textContent, name).not.toContain('{{');
        }
      }
    }
    setViewport(390, 844);
  });

  it('one sentence, one close', () => {
    const onClose = vi.fn<() => void>();
    const root = draw({ onClose });
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual([TITLE]);
    expect(document.activeElement).toBe(headings[0]);

    const close = screen.getByTestId('system.adults-only-close');
    expect(screen.getByRole('button', { name: 'Close' })).toBe(close);
    // It asks nothing and offers no second answer: Close is the one control.
    expect([...root.querySelectorAll('a, button, [role="button"], [role="link"]')]).toEqual([
      close,
    ]);
    expect(root.querySelectorAll('input, select, textarea, [role="combobox"]')).toHaveLength(0);
    // The name, the sentence and the button are all the words; no age is stated.
    expect(root.textContent).toBe(`${TITLE}Close`);
    expect(root.textContent).not.toMatch(/\d/);

    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
