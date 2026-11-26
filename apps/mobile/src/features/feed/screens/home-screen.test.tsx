import { BRAND } from '@citizenrun/shared';
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/feed/view-models/home.fixtures';
import type { HomeViewModel } from '@/features/feed/view-models/home.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { HomeScreenView } from './home-screen';

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

const FIXTURES: Readonly<Record<string, HomeViewModel>> = fixtures;
const TITLE = 'Your feed starts here.';
const BODY = 'Offices near you and posts from people you follow will show up here.';
const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: HomeViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<HomeScreenView vm={vm} />, options);
  return screen.getByTestId('feed.home');
}

describe('HomeScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toEqual(['homePlaceholder']);
    for (const [width, height] of [[360, 740], [430, 932], MEDIUM, EXPANDED] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        for (const theme of ['light', 'dark'] as const) {
          const root = draw(vm, { theme });
          expect(root.textContent, name).not.toContain('{{');
          expect(screen.getByTestId('feed.placeholder'), name).toBeTruthy();
        }
      }
    }
    setViewport(...COMPACT);
  });

  it('the placeholder', () => {
    for (const viewport of [COMPACT, MEDIUM, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      const root = draw(fixtures.homePlaceholder);
      const placeholder = screen.getByTestId('feed.placeholder');
      expect(root.contains(placeholder)).toBe(true);

      // The sentence is the screen's one heading, and a screen reader starts on it.
      const headings = screen.getAllByRole('heading');
      expect(headings.map((heading) => heading.textContent)).toEqual([TITLE]);
      expect(screen.getAllByRole('heading', { level: 1 })).toEqual(headings);
      expect(document.activeElement).toBe(headings[0]);
      // One sentence and one line, and no step to take.
      expect(placeholder.textContent).toBe(`${TITLE}${BODY}`);
      expect(root.querySelectorAll('button, [role="button"], a, [role="link"]')).toHaveLength(0);

      // The chair is drawn, and says nothing to a screen reader.
      const chair = placeholder.querySelector('svg');
      expect(chair).not.toBeNull();
      expect(chair?.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(within(placeholder).queryByRole('img')).toBeNull();
    }
    setViewport(...COMPACT);
  });

  it('home bar at compact only', () => {
    setViewport(...COMPACT);
    let root = draw(fixtures.homePlaceholder);
    expect(within(root).getByRole('img', { name: BRAND.displayName })).toBeTruthy();
    expect(screen.queryByTestId('shell.app-bar-messages')).toBeNull();
    for (const viewport of [MEDIUM, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      root = draw(fixtures.homePlaceholder);
      expect(within(root).queryByRole('img', { name: BRAND.displayName })).toBeNull();
      expect(screen.queryByTestId('shell.app-bar-messages')).toBeNull();
    }
    setViewport(...COMPACT);
  });

  it('the words keep the gutter where the feed column runs edge to edge', () => {
    // The feed column has its own padding beside the rail; on a phone it has none.
    setViewport(...COMPACT);
    draw(fixtures.homePlaceholder);
    const narrow = screen.getByTestId('feed.placeholder').parentElement;
    expect(narrow?.style.paddingLeft).toBe('24px');
    expect(narrow?.style.paddingRight).toBe('24px');

    setViewport(360, 740);
    draw(fixtures.homePlaceholder);
    const small = screen.getByTestId('feed.placeholder').parentElement;
    expect(small?.style.paddingLeft).toBe('16px');

    setViewport(...EXPANDED);
    draw(fixtures.homePlaceholder);
    const wide = screen.getByTestId('feed.placeholder').parentElement;
    expect(wide?.style.paddingLeft ?? '').toBe('');
    setViewport(...COMPACT);
  });
});
