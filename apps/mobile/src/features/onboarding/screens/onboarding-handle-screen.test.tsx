import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/onboarding/view-models/handle.fixtures';
import type { OnboardingHandleViewModel } from '@/features/onboarding/view-models/handle.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';

import { OnboardingHandleScreenView } from './onboarding-handle-screen';

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

const FIXTURES: Readonly<Record<string, OnboardingHandleViewModel>> = fixtures;

const HELPER =
  '3 to 20 characters: letters, numbers, _ and . You can change it once every 30 days.';

const STATUS_LINES: Readonly<Record<string, string>> = {
  handleFree: 'That one is free.',
  handleTaken: 'Taken. Try another.',
  handleReserved: 'That one is not available. Try another.',
  handleTooShort: 'Use at least 3 characters.',
  handleTooLong: 'Use 20 characters or fewer.',
  handleCharacters: 'Use letters, numbers, underscores and periods.',
  handleDots: "A period can't start or end a handle, or follow another period.",
  handleNoLetter: 'Use at least one letter or number.',
  handleCheckFailed: 'We could not check that. Try again.',
};

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: OnboardingHandleViewModel): HTMLElement {
  cleanup();
  renderWithProviders(<OnboardingHandleScreenView vm={vm} />);
  return screen.getByTestId('onboarding.handle');
}

function fixture(name: string): OnboardingHandleViewModel {
  const found = FIXTURES[name];
  if (found === undefined) {
    throw new Error(`no fixture ${name}`);
  }
  return found;
}

function continueButton(): HTMLElement {
  return screen.getByTestId('onboarding.handle-continue');
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

/** How many times a sentence stands in a box. */
function timesIn(box: HTMLElement, sentence: string): number {
  return box.textContent.split(sentence).length - 1;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('OnboardingHandleScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(15);
    for (const [width, height] of [
      [360, 740],
      [390, 844],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        const root = draw(vm);
        expect(root.textContent, name).not.toContain('{{');
        expect(
          screen.getAllByRole('heading', { level: 1 }).map((title) => title.textContent),
          name,
        ).toEqual(['Pick your handle']);
        expect(screen.getByRole('progressbar', { name: 'Step 3 of 5' })).toBeTruthy();
        expect(screen.getByTestId('shell.app-bar-back')).toBeTruthy();
      }
    }
    setViewport(390, 844);
  });

  it('status lines', () => {
    for (const [name, sentence] of Object.entries(STATUS_LINES)) {
      const root = draw(fixture(name));
      expect(timesIn(root, sentence), name).toBe(1);
      // The field is described by its line, so a screen reader hears the answer with the field.
      const field = screen.getByTestId('onboarding.handle-field');
      const described = (field.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '');
      expect(described.join(' '), name).toContain(sentence);
    }
    const idle = draw(fixtures.handleEmpty);
    for (const sentence of Object.values(STATUS_LINES)) {
      expect(timesIn(idle, sentence)).toBe(0);
    }
    expect(timesIn(draw(fixtures.handleChecking), 'Checking')).toBe(1);
  });

  it('continue is free or unchanged', () => {
    draw(fixtures.handleEmpty);
    expect(screen.getByRole('button', { name: 'Pick a handle that is free' })).toBe(
      continueButton(),
    );
    expect(isDisabled(continueButton())).toBe(true);

    const onContinue = vi.fn<() => void>();
    draw({ ...fixtures.handleFree, onContinue });
    expect(screen.getByRole('button', { name: 'Continue' })).toBe(continueButton());
    expect(isDisabled(continueButton())).toBe(false);
    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalledTimes(1);

    // The handle the person already has, untouched.
    draw({ ...fixtures.handleEmpty, initialHandle: 'test_fixture' });
    const field = screen.getByTestId<HTMLInputElement>('onboarding.handle-field');
    expect(field.value).toBe('test_fixture');
    expect(isDisabled(continueButton())).toBe(false);
    // Typing another one waits for its check.
    fireEvent.change(field, { target: { value: 'test_other' } });
    expect(isDisabled(continueButton())).toBe(true);
    expect(continueButton().textContent).toBe('Pick a handle that is free');

    for (const name of ['handleTaken', 'handleReserved', 'handleTooShort', 'handleChecking']) {
      draw(fixture(name));
      expect(isDisabled(continueButton()), name).toBe(true);
    }
    // A check that could not run leaves the answer to the server.
    draw(fixtures.handleCheckFailed);
    expect(isDisabled(continueButton())).toBe(false);
  });

  it('typing reaches the view-model', () => {
    const onChange = vi.fn<(value: string) => void>();
    draw({ ...fixtures.handleEmpty, onChange });
    const field = screen.getByTestId<HTMLInputElement>('onboarding.handle-field');
    expect(screen.getByLabelText('Handle')).toBe(field);
    fireEvent.change(field, { target: { value: 'Ab' } });
    expect(onChange.mock.calls).toEqual([['ab']]);
    expect(field.value).toBe('ab');
  });

  it('sending makes continue busy', () => {
    const onContinue = vi.fn<() => void>();
    draw({ ...fixtures.handleSending, onContinue });
    expect(continueButton().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('too soon names the date', () => {
    vi.stubEnv('TZ', 'America/New_York');
    draw(fixtures.handleChangeTooSoon);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(
      'You changed your handle recently. You can change it again on February 14, 2027.',
    );
    // The date is the device's own day: the same instant is the next day far east of it.
    vi.stubEnv('TZ', 'Pacific/Kiritimati');
    draw(fixtures.handleChangeTooSoon);
    expect(screen.getByRole('alert').textContent).toContain('on February 15, 2027.');
  });

  it('a refusal with no date reads its own sentence', () => {
    draw({
      ...fixtures.handleFree,
      submit: { status: 'idle', errorCode: 'unavailable', changeAvailableAt: null },
    });
    expect(screen.getByRole('alert').textContent).toBe(
      "This isn't available right now. Try again in a few minutes.",
    );
    draw({
      ...fixtures.handleFree,
      submit: { status: 'idle', errorCode: 'handle_change_too_soon', changeAvailableAt: null },
    });
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.');
    draw(fixtures.handleFree);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the helper is always shown', () => {
    expect(within(draw(fixtures.handleEmpty)).getByText(HELPER)).toBeTruthy();
    expect(within(draw(fixtures.handleTaken)).getByText(HELPER)).toBeTruthy();
  });

  it('back calls the view-model', () => {
    const onBack = vi.fn<() => void>();
    draw({ ...fixtures.handleEmpty, onBack });
    fireEvent.click(screen.getByTestId('shell.app-bar-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('offline disables the footer', () => {
    const onContinue = vi.fn<() => void>();
    const root = draw({ ...fixtures.handleOffline, onContinue });
    expect(within(root).getByText('No connection. This may be out of date.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Needs a connection' })).toBe(continueButton());
    expect(isDisabled(continueButton())).toBe(true);
    fireEvent.click(continueButton());
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('the heading is smaller on a tight layout', () => {
    draw(fixtures.handleEmpty);
    const wide = screen.getByRole('heading', { level: 1 }).style.fontSize;
    layout.isTight = true;
    try {
      draw(fixtures.handleEmpty);
      const tight = screen.getByRole('heading', { level: 1 }).style.fontSize;
      expect(Number.parseFloat(tight)).toBeLessThan(Number.parseFloat(wide));
    } finally {
      layout.isTight = false;
    }
  });
});
