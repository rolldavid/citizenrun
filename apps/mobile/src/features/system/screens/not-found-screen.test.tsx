import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { NotFoundScreenView } from './not-found-screen';

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

/** Renders the screen, in place of whatever was drawn before. */
function draw(options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<NotFoundScreenView />, options);
  return screen.getByTestId('system.not-found');
}

describe('NotFoundScreenView', () => {
  it('renders', () => {
    for (const viewport of VIEWPORTS) {
      sized(viewport);
      for (const theme of ['light', 'dark'] as const) {
        const root = draw({ theme });
        expect(root.textContent).not.toContain('{{');
        expect(screen.getAllByRole('main')).toHaveLength(1);
      }
    }
  });

  it('has a level 1 title, the body and a link home', () => {
    sized(COMPACT);
    const root = draw();
    const titles = screen.getAllByRole('heading', { level: 1 });
    expect(titles.map((title) => title.textContent)).toEqual(['This page does not exist.']);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(document.activeElement).toBe(titles[0]);
    expect(within(root).getByText('Check the link, or start from Home.')).toBeTruthy();
    const home = screen.getByTestId('system.not-found-home');
    expect(home.textContent).toBe('Go to Home');
    expect(home.getAttribute('role')).toBe('link');
    expect(home.getAttribute('href')).toBe('/');
    // One way on, and nothing else to press.
    expect(root.querySelectorAll('a, button, [role="button"], [role="link"]')).toHaveLength(1);
  });

  it('the chair is decorative', () => {
    sized(COMPACT);
    const root = draw();
    const chair = root.querySelector('svg');
    expect(chair).not.toBeNull();
    expect(chair?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryAllByRole('img')).toEqual([]);
  });

  it('has no bar and no wordmark at any width', () => {
    for (const viewport of VIEWPORTS) {
      sized(viewport);
      const root = draw();
      expect(root.querySelectorAll('svg')).toHaveLength(1);
      expect(screen.queryByTestId('shell.app-bar-back')).toBeNull();
    }
  });
});
