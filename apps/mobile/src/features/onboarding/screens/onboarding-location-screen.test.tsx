import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/onboarding/view-models/location.fixtures';
import type { OnboardingLocationSoonViewModel } from '@/features/onboarding/view-models/location.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';

import { OnboardingLocationScreenView } from './onboarding-location-screen';

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

const FIXTURES: Readonly<Record<string, OnboardingLocationSoonViewModel>> = fixtures;

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: OnboardingLocationSoonViewModel): HTMLElement {
  cleanup();
  renderWithProviders(<OnboardingLocationScreenView vm={vm} />);
  return screen.getByTestId('onboarding.location');
}

function continueButton(): HTMLElement {
  return screen.getByTestId('onboarding.location-skip');
}

describe('OnboardingLocationScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(4);
    for (const [width, height] of [
      [360, 740],
      [390, 844],
      [820, 1180],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        const root = draw(vm);
        expect(root.textContent, name).not.toContain('{{');
        expect(screen.getByRole('progressbar', { name: 'Step 5 of 5' })).toBeTruthy();
      }
    }
    setViewport(390, 844);
  });

  it('skip-only form', () => {
    const onSkip = vi.fn<() => void>();
    const root = draw({ ...fixtures.locationSoon, onSkip });
    expect(screen.getAllByRole('heading', { level: 1 }).map((title) => title.textContent)).toEqual([
      'Your districts come next',
    ]);
    expect(
      within(root).getByText(
        'Soon you can add where you live to see your own offices. For now your feed covers the whole country.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBe(continueButton());
    expect(continueButton().textContent).toBe('Continue');
    // The step asks for nothing: back and Continue are its only controls.
    expect([...root.querySelectorAll('button, [role="button"], input, a')]).toEqual([
      screen.getByTestId('shell.app-bar-back'),
      continueButton(),
    ]);
    fireEvent.click(continueButton());
    expect(onSkip).toHaveBeenCalledTimes(1);

    const sending = vi.fn<() => void>();
    draw({ ...fixtures.locationSoonSending, onSkip: sending });
    expect(continueButton().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(continueButton());
    expect(sending).not.toHaveBeenCalled();
  });

  it('back calls the view-model', () => {
    const onBack = vi.fn<() => void>();
    draw({ ...fixtures.locationSoon, onBack });
    fireEvent.click(screen.getByTestId('shell.app-bar-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the chair', () => {
    expect(
      draw(fixtures.locationSoon).querySelector('svg[aria-hidden], [aria-hidden] svg'),
    ).not.toBeNull();
    layout.isTight = true;
    try {
      const tight = draw(fixtures.locationSoon);
      // The back arrow is the one drawing left.
      const drawings = [...tight.querySelectorAll('svg')].filter(
        (drawing) => !screen.getByTestId('shell.app-bar-back').contains(drawing),
      );
      expect(drawings).toEqual([]);
    } finally {
      layout.isTight = false;
    }
  });

  it('error and offline', () => {
    draw(fixtures.locationSoonError);
    expect(screen.getByRole('alert').textContent).toBe(
      "This isn't available right now. Try again in a few minutes.",
    );
    expect(continueButton().getAttribute('aria-disabled')).not.toBe('true');

    const onSkip = vi.fn<() => void>();
    const root = draw({ ...fixtures.locationSoonOffline, onSkip });
    expect(within(root).getByText('No connection. This may be out of date.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Needs a connection' })).toBe(continueButton());
    expect(continueButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(continueButton());
    expect(onSkip).not.toHaveBeenCalled();
  });
});
