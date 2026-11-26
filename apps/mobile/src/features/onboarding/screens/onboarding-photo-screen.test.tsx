import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/onboarding/view-models/photo.fixtures';
import type { OnboardingPhotoViewModel } from '@/features/onboarding/view-models/photo.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';

import { OnboardingPhotoScreenView } from './onboarding-photo-screen';

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

// The image library does not load in this environment. This stands in for its view.
vi.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>): ReactElement =>
    createElement('div', { 'data-photo': props['recyclingKey'] }),
}));

const FIXTURES: Readonly<Record<string, OnboardingPhotoViewModel>> = fixtures;

const VIEWPORTS = [
  [360, 740],
  [390, 844],
  [820, 1180],
  [1440, 900],
] as const;

const SENTENCES: Readonly<Record<string, string>> = {
  photoFailedPhotosBlocked:
    'Photo access is off for this app. Allow it in Settings to choose photos.',
  photoFailedUnsupportedFormat:
    "This file type isn't supported. Choose a JPEG, PNG or WebP photo, or an MP4, MOV or WebM video.",
  photoFailedPhotoTooLarge: 'This photo is too large to post.',
  photoFailedPrepareFailed: "We couldn't prepare this file. Try another one.",
  photoFailedUploadFailed: "The upload didn't finish.",
  photoFailedRateLimited: 'Too many tries in a short time. Wait a moment and try again.',
  photoFailedGeneric: 'Something went wrong. Try again.',
};

type Spies = {
  onChoose: () => void;
  onContinue: () => void;
  onSkip: () => void;
  onOpenSettings: () => void;
};

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: OnboardingPhotoViewModel): HTMLElement {
  cleanup();
  renderWithProviders(<OnboardingPhotoScreenView vm={vm} />);
  return screen.getByTestId('onboarding.photo');
}

/** A fixture whose four callbacks count their calls. */
function spied(vm: OnboardingPhotoViewModel): { vm: OnboardingPhotoViewModel; spies: Spies } {
  const spies: Spies = {
    onChoose: vi.fn<() => void>(),
    onContinue: vi.fn<() => void>(),
    onSkip: vi.fn<() => void>(),
    onOpenSettings: vi.fn<() => void>(),
  };
  return { vm: { ...vm, ...spies }, spies };
}

function button(testID: string): HTMLElement {
  return screen.getByTestId(testID);
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

/** How a button is drawn: the look of its box and of its label. */
function lookOf(element: HTMLElement): string[] {
  return [element, ...element.querySelectorAll<HTMLElement>('*')].map(
    (each) => `${each.className} | ${each.style.cssText}`,
  );
}

/** The nearest box that holds both elements. */
function sharedBox(first: HTMLElement, second: HTMLElement): HTMLElement {
  for (let box = first.parentElement; box !== null; box = box.parentElement) {
    if (box.contains(second)) {
      return box;
    }
  }
  throw new Error('the two elements share no box');
}

describe('OnboardingPhotoScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(12);
    for (const [width, height] of VIEWPORTS) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        const root = draw(vm);
        expect(root.textContent, name).not.toContain('{{');
        const titles = screen.getAllByRole('heading', { level: 1 });
        expect(
          titles.map((title) => title.textContent),
          name,
        ).toEqual(['Add a photo']);
        expect(within(root).getByText('So people know it is you. You can skip this.')).toBeTruthy();
      }
    }
    setViewport(390, 844);
  });

  it('skip is as prominent as choose', () => {
    setViewport(390, 844);
    const { vm, spies } = spied(fixtures.photoNone);
    draw(vm);
    const choose = button('onboarding.photo-choose');
    const skip = button('onboarding.photo-skip');
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBe(choose);
    expect(screen.getByRole('button', { name: 'Skip' })).toBe(skip);
    expect(isDisabled(choose)).toBe(false);
    expect(isDisabled(skip)).toBe(false);
    // One variant and one size: the two are drawn alike, and unlike the ink button of the footer.
    expect(lookOf(skip)).toEqual(lookOf(choose));
    expect(lookOf(button('onboarding.photo-continue'))).not.toEqual(lookOf(choose));
    // Side by side, each with an equal share of the row.
    const row = sharedBox(choose, skip);
    expect(row.style.flexDirection).toBe('row');
    const halves = [...row.children].map((half) =>
      half instanceof HTMLElement ? half.style.flexGrow : '',
    );
    expect(halves).toEqual(['1', '1']);
    expect(row.children[0]?.contains(choose)).toBe(true);
    expect(row.children[1]?.contains(skip)).toBe(true);

    fireEvent.click(skip);
    expect(spies.onSkip).toHaveBeenCalledTimes(1);
    fireEvent.click(choose);
    expect(spies.onChoose).toHaveBeenCalledTimes(1);
  });

  it('the two buttons stack on a tight layout', () => {
    layout.isTight = true;
    try {
      draw(fixtures.photoReady);
      const choose = button('onboarding.photo-choose');
      const skip = button('onboarding.photo-skip');
      // One over the other, each as wide as the column, so a wrapped label leaves them one size.
      const column = sharedBox(choose, skip);
      expect(column.style.flexDirection).not.toBe('row');
      expect(column.children).toHaveLength(2);
      expect(column.children[0]?.contains(choose)).toBe(true);
      expect(column.children[1]?.contains(skip)).toBe(true);
      expect(lookOf(skip)).toEqual(lookOf(choose));
    } finally {
      layout.isTight = false;
    }
  });

  it('continue waits for a photo', () => {
    const none = spied(fixtures.photoNone);
    draw(none.vm);
    const waiting = button('onboarding.photo-continue');
    expect(screen.getByRole('button', { name: 'Choose a photo, or skip' })).toBe(waiting);
    expect(waiting.textContent).toBe('Choose a photo, or skip');
    expect(isDisabled(waiting)).toBe(true);
    fireEvent.click(waiting);
    expect(none.spies.onContinue).not.toHaveBeenCalled();

    const ready = spied(fixtures.photoReady);
    draw(ready.vm);
    const go = button('onboarding.photo-continue');
    expect(screen.getByRole('button', { name: 'Continue' })).toBe(go);
    expect(isDisabled(go)).toBe(false);
    expect(button('onboarding.photo-choose').textContent).toBe('Choose another');
    expect(screen.queryByText('Choose a photo')).toBeNull();
    fireEvent.click(go);
    expect(ready.spies.onContinue).toHaveBeenCalledTimes(1);
  });

  it('uploading disables everything', () => {
    const { vm, spies } = spied(fixtures.photoUploading);
    draw(vm);
    const bar = screen.getByRole('progressbar', { name: 'Uploading' });
    expect(bar.getAttribute('aria-valuenow')).toBe('120000');
    expect(bar.getAttribute('aria-valuemax')).toBe('480000');

    const choose = button('onboarding.photo-choose');
    const skip = button('onboarding.photo-skip');
    const go = button('onboarding.photo-continue');
    expect(isDisabled(choose)).toBe(true);
    expect(isDisabled(skip)).toBe(true);
    // The button that is sending the photo says it is busy, and takes no second press.
    expect(go.getAttribute('aria-busy')).toBe('true');
    for (const each of [choose, skip, go]) {
      fireEvent.click(each);
    }
    expect(spies.onChoose).not.toHaveBeenCalled();
    expect(spies.onSkip).not.toHaveBeenCalled();
    expect(spies.onContinue).not.toHaveBeenCalled();
  });

  it('skipping keeps the other buttons still', () => {
    const { vm, spies } = spied({ ...fixtures.photoReady, skipStatus: 'sending' });
    draw(vm);
    const skip = button('onboarding.photo-skip');
    expect(skip.getAttribute('aria-busy')).toBe('true');
    expect(isDisabled(button('onboarding.photo-choose'))).toBe(true);
    expect(isDisabled(button('onboarding.photo-continue'))).toBe(true);
    for (const id of [
      'onboarding.photo-choose',
      'onboarding.photo-skip',
      'onboarding.photo-continue',
    ]) {
      fireEvent.click(button(id));
    }
    expect(spies.onChoose).not.toHaveBeenCalled();
    expect(spies.onSkip).not.toHaveBeenCalled();
    expect(spies.onContinue).not.toHaveBeenCalled();
  });

  it('each failure has its sentence', () => {
    expect(
      Object.keys(FIXTURES)
        .filter((name) => name.startsWith('photoFailed'))
        .sort(),
    ).toEqual(Object.keys(SENTENCES).sort());
    for (const [name, sentence] of Object.entries(SENTENCES)) {
      const fixture = FIXTURES[name];
      if (fixture === undefined) {
        throw new Error(`no fixture ${name}`);
      }
      const { vm, spies } = spied(fixture);
      draw(vm);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText(sentence), name).toBeTruthy();
      const actions = within(alert).queryAllByRole('button');

      if (name === 'photoFailedUploadFailed') {
        expect(actions).toEqual([button('onboarding.photo-retry')]);
        expect(actions[0]?.textContent).toBe('Try again');
        fireEvent.click(button('onboarding.photo-retry'));
        expect(spies.onContinue).toHaveBeenCalledTimes(1);
      } else if (name === 'photoFailedPhotosBlocked') {
        expect(actions).toEqual([button('onboarding.photo-settings')]);
        expect(screen.getByRole('button', { name: 'Open settings' })).toBe(actions[0]);
        fireEvent.click(button('onboarding.photo-settings'));
        expect(spies.onOpenSettings).toHaveBeenCalledTimes(1);
      } else {
        expect(actions, name).toEqual([]);
      }
    }
  });

  it('a failure with no photo left waits for a new one', () => {
    draw(fixtures.photoFailedPrepareFailed);
    expect(isDisabled(button('onboarding.photo-continue'))).toBe(true);
    expect(button('onboarding.photo-continue').textContent).toBe('Choose a photo, or skip');
    expect(button('onboarding.photo-choose').textContent).toBe('Choose a photo');

    draw(fixtures.photoFailedGeneric);
    expect(isDisabled(button('onboarding.photo-continue'))).toBe(false);
    expect(button('onboarding.photo-choose').textContent).toBe('Choose another');
  });

  it('the step bar', () => {
    const root = draw(fixtures.photoNone);
    const bar = screen.getByRole('progressbar', { name: 'Step 2 of 5' });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    // The count is drawn for the eye; the bar's name says it.
    expect(within(root).getByText('2 / 5').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByTestId('shell.app-bar-back')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
  });

  it('the step bar keeps to the column in a wide window', () => {
    setViewport(1440, 900);
    try {
      draw(fixtures.photoNone);
      const bar = screen.getByRole('progressbar', { name: 'Step 2 of 5' });
      const row = bar.parentElement?.parentElement;
      const widest = Number.parseFloat(row?.style.maxWidth ?? '');
      // The column is 600 wide at most, less its two gutters.
      expect(widest).toBeGreaterThan(500);
      expect(widest).toBeLessThan(600);
      expect(row?.style.alignSelf).toBe('center');
    } finally {
      setViewport(390, 844);
    }
  });

  it('offline disables the footer', () => {
    const { vm, spies } = spied(fixtures.photoOffline);
    const root = draw(vm);
    expect(within(root).getByText('No connection. This may be out of date.')).toBeTruthy();
    const go = button('onboarding.photo-continue');
    expect(screen.getByRole('button', { name: 'Needs a connection' })).toBe(go);
    expect(isDisabled(go)).toBe(true);
    fireEvent.click(go);
    expect(spies.onContinue).not.toHaveBeenCalled();
  });

  it('the heading is smaller on a tight layout', () => {
    draw(fixtures.photoNone);
    const wide = screen.getByRole('heading', { level: 1 }).style.fontSize;
    layout.isTight = true;
    try {
      draw(fixtures.photoNone);
      const tight = screen.getByRole('heading', { level: 1 }).style.fontSize;
      expect(Number.parseFloat(tight)).toBeLessThan(Number.parseFloat(wide));
    } finally {
      layout.isTight = false;
    }
  });
});
