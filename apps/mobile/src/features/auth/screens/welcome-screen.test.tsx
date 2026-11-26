import { BRAND } from '@citizenrun/shared';
import { cleanup, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/auth/view-models/welcome.fixtures';
import type { WelcomeViewModel } from '@/features/auth/view-models/welcome.types';
import { getI18n } from '@/lib/i18n';
import { headFake } from '@/test/platform/head';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';

import { WelcomeScreen, WelcomeScreenView } from './welcome-screen';

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

// The layout the screen reads: the window's own, made tight when a case asks for it. The page
// never reports a text size above the default, so no window makes a layout tight by itself.
const layout = vi.hoisted(() => {
  const state: { isTight: boolean } = { isTight: false };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout => {
      const own = actual.useBreakpoint();
      return layout.isTight ? { ...own, isTight: true } : own;
    },
  };
});

const FIXTURES: Readonly<Record<string, WelcomeViewModel>> = fixtures;
const TITLE = 'See the offices you could run for.';
const BODY = 'What each one pays, what it decides, and how to get on the ballot.';

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: WelcomeViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<WelcomeScreenView vm={vm} />, options);
  return screen.getByTestId('auth.welcome');
}

/** The chair, where it stands: the one drawing with a disc behind it, skipped by a screen reader. */
function chairs(root: HTMLElement): Element[] {
  return [...root.querySelectorAll('svg')].filter(
    (drawing) =>
      drawing.querySelector('circle') !== null && drawing.closest('[aria-hidden="true"]') !== null,
  );
}

describe('WelcomeScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toEqual(['welcomeDefault']);
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
          expect(root.textContent, name).not.toContain('<');
        }
      }
    }
    setViewport(390, 844);
  });

  it('one heading, the chair, the start link', () => {
    const root = draw(fixtures.welcomeDefault);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings.map((heading) => heading.textContent)).toEqual([TITLE]);
    // A screen reader announces the screen by its heading.
    expect(document.activeElement).toBe(headings[0]);
    expect(within(root).getByText(BODY)).toBeTruthy();
    expect(screen.getByRole('img', { name: BRAND.displayName })).toBeTruthy();
    expect(chairs(root)).toHaveLength(1);

    const start = screen.getByTestId('auth.welcome-start');
    expect(start.getAttribute('role')).toBe('link');
    expect(start.getAttribute('href')).toBe(fixtures.welcomeDefault.startHref);
    expect(start.textContent).toBe('Continue');
    // No app bar: nothing leads back from the first screen.
    expect(screen.queryByTestId('shell.app-bar-back')).toBeNull();

    const terms = screen.getByTestId('auth.welcome-terms');
    expect(terms.getAttribute('href')).toBe('https://example.test/terms');
    expect(terms.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'Terms, opens in your browser' })).toBe(terms);
    const privacy = screen.getByTestId('auth.welcome-privacy');
    expect(privacy.getAttribute('href')).toBe('https://example.test/privacy');
    expect(privacy.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'Privacy policy, opens in your browser' })).toBe(
      privacy,
    );
    // The start link and the two documents are everything a person can press.
    expect([...root.querySelectorAll('a, button, [role="button"], [role="link"], input')]).toEqual([
      terms,
      privacy,
      start,
    ]);
  });

  it('the start link carries where to go after signing in', () => {
    draw({ ...fixtures.welcomeDefault, startHref: '/sign-in?next=%2Fsettings' });
    expect(screen.getByTestId('auth.welcome-start').getAttribute('href')).toBe(
      '/sign-in?next=%2Fsettings',
    );
  });

  it('tight drops the chair', () => {
    const wide = draw(fixtures.welcomeDefault);
    const wideSize = screen.getByRole('heading', { level: 1 }).style.fontSize;
    expect(chairs(wide)).toHaveLength(1);
    layout.isTight = true;
    try {
      const tight = draw(fixtures.welcomeDefault);
      expect(chairs(tight)).toEqual([]);
      // The heading takes the smaller of its two roles; the words stay.
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading.textContent).toBe(TITLE);
      expect(Number.parseFloat(heading.style.fontSize)).toBeLessThan(Number.parseFloat(wideSize));
      expect(screen.getByRole('img', { name: BRAND.displayName })).toBeTruthy();
      expect(screen.getByTestId('auth.welcome-start')).toBeTruthy();
    } finally {
      layout.isTight = false;
    }
  });

  it('a narrow window at a large text size is tight too', () => {
    setViewport(360, 740);
    try {
      expect(chairs(draw(fixtures.welcomeDefault, { textScale: 1.3 }))).toEqual([]);
      expect(chairs(draw(fixtures.welcomeDefault))).toHaveLength(1);
      setViewport(430, 932);
      expect(chairs(draw(fixtures.welcomeDefault, { textScale: 1.3 }))).toHaveLength(1);
    } finally {
      setViewport(390, 844);
    }
  });

  it('legal links need https', () => {
    const root = draw({
      ...fixtures.welcomeDefault,
      links: { terms: 'http://api.test/terms', privacyPolicy: '/privacy' },
    });
    // The words stay in the line; neither is a link, and neither opens anything.
    expect(root.textContent).toContain('Terms · Privacy policy');
    expect(screen.queryByTestId('auth.welcome-terms')).toBeNull();
    expect(screen.queryByTestId('auth.welcome-privacy')).toBeNull();
    expect(screen.getAllByRole('link')).toEqual([screen.getByTestId('auth.welcome-start')]);

    draw({
      ...fixtures.welcomeDefault,
      links: { terms: 'https://example.test/terms', privacyPolicy: '/privacy' },
    });
    expect(screen.getByTestId('auth.welcome-terms').getAttribute('href')).toBe(
      'https://example.test/terms',
    );
    expect(screen.queryByTestId('auth.welcome-privacy')).toBeNull();
  });
});

describe('WelcomeScreen', () => {
  it('names the page and passes next on', () => {
    renderWithProviders(<WelcomeScreen next="/settings/delete-account" />);
    expect(headFake.title()).toBe(getI18n().t('common:documentTitle', { title: 'Welcome' }));
    expect(headFake.title()).toMatch(/^Welcome · .+$/);
    const href = screen.getByTestId('auth.welcome-start').getAttribute('href') ?? '';
    expect(href.startsWith('/sign-in')).toBe(true);
    expect(decodeURIComponent(href)).toContain('/settings/delete-account');

    cleanup();
    renderWithProviders(<WelcomeScreen next={null} />);
    expect(screen.getByTestId('auth.welcome-start').getAttribute('href')).toBe('/sign-in');
  });
});
