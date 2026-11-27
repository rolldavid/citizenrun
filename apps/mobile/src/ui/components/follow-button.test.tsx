import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import type { JSX, ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { color, rule, size, space } from '@/ui/tokens';

import { FollowButton } from './follow-button';
import type { FollowButtonProps } from './follow-button';
import { GROUND, PREVIEW, STATES } from './follow-button.fixtures';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// An interface icon loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('an interface icon loads no asset');
  },
}));

// The props each native Pressable receives, so the cases below can read what a phone is told: the
// web drops those props before they reach the page.
const pressables = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>();
  return {
    ...actual,
    Pressable: (props: ReactNative.PressableProps): ReactElement => {
      pressables.props.push({ ...props });
      return createElement(actual.Pressable, props);
    },
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = ['idle', 'following', 'small', 'smallFollowing'] as const;

const ALL: Readonly<Record<StateName, FollowButtonProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const CHECK = 'M5 12.500 10 17.500 19 7';
/** A step shorter than a frame, so no frame of a run is missed. */
const STEP_MS = 10;
/** Longer than the stamp's spring takes to settle. */
const SETTLED_MS = 1500;
/** A haptic is dropped when it follows another too closely. */
const HAPTIC_GAP_MS = 200;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one button, in place of whatever was drawn before. */
function draw(props: FollowButtonProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  pressables.props = [];
  renderWithProviders(<FollowButton {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** The props C-Pressable gave the native Pressable. */
function nativeProps(): Record<string, unknown> {
  const found = pressables.props.at(-1);
  if (found === undefined) {
    throw new Error('no native Pressable was rendered');
  }
  return found;
}

/** The parts that hold a button's width: the box that hugs the lock, and the twin under the button. */
function lockOf(button: HTMLElement): { hug: HTMLElement; twin: HTMLElement } {
  for (let part = button.parentElement; part !== null; part = part.parentElement) {
    const twin = [...part.children].find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.style.height === '0px' && !child.contains(button),
    );
    if (twin !== undefined && part.parentElement !== null) {
      return { hug: part.parentElement, twin };
    }
  }
  throw new Error('the button has no width lock');
}

/** The scale the stamp holds the button at: 1 at rest. */
function stampScale(button: HTMLElement): number {
  for (let part = button.parentElement; part !== null; part = part.parentElement) {
    const found = /scale\(([0-9.]+)\) rotate/.exec(part.style.transform);
    if (found?.[1] !== undefined) {
      return Number(found[1]);
    }
  }
  return 1;
}

/** The button's stamp scale at each step of `ms`. */
function watch(ms: number, testID: string): number[] {
  const seen: number[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    seen.push(stampScale(screen.getByTestId(testID)));
  }
  return seen;
}

/** A button that holds its own truth, as a screen does. */
function Live({ fixture }: { fixture: FollowButtonProps }): JSX.Element {
  const [following, setFollowing] = useState(fixture.following);
  return (
    <FollowButton
      {...fixture}
      following={following}
      onToggle={() => {
        setFollowing(!following);
      }}
    />
  );
}

// A haptic is dropped when it follows another too closely, so each case starts a minute after the last.
let clock = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock += 60_000;
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FollowButton', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const fixture = ALL[state];
          const button = draw(fixture, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const box = button.querySelector<HTMLElement>('[style*="min-height"]');
          // An outline with "Follow", and ink with the check and "Following". No third look, no color.
          expect(button.textContent, name).toBe(fixture.following ? 'Following' : 'Follow');
          expect(box?.style.backgroundColor, name).toBe(
            fixture.following ? written(color[theme].inverseBg) : '',
          );
          expect(box?.style.borderColor, name).toBe(
            fixture.following ? 'rgba(0, 0, 0, 0)' : written(color[theme].rule),
          );
          expect(
            [...button.querySelectorAll('path')].map((path) => path.getAttribute('d')),
            name,
          ).toEqual(fixture.following ? [CHECK] : []);
          expect(box?.style.minHeight, name).toBe(
            `${String(fixture.size === 'sm' ? size.buttonSmall : size.button)}px`,
          );
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the four states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].subject, state).toBe('Carol Wynn');
    }
    expect(STATES.idle.following).toBe(false);
    expect(STATES.following.following).toBe(true);
    expect(STATES.small).toMatchObject({ following: false, size: 'sm' });
    expect(STATES.smallFollowing).toMatchObject({ following: true, size: 'sm' });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const button = draw(fixture);
      const name = fixture.following ? 'Following Carol Wynn' : 'Follow Carol Wynn';
      expect(screen.getByRole('button', { name }), state).toBe(button);
      expect(screen.getAllByRole('button'), state).toHaveLength(1);
      // The check and the twin add nothing to the name.
      expect(document.querySelectorAll('[role="img"]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const button = draw(ALL[state]);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(ALL[state].testID, state).toMatch(/^gallery\.follow-button-/);
      expect(button.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    cleanup();
    renderWithProviders(<Live fixture={STATES.idle} />, { reducedMotion: true });
    fireEvent.click(screen.getByTestId(STATES.idle.testID));
    expect(screen.getByTestId(STATES.idle.testID).textContent).toBe('Following');
    // The done state fades in where it stands: nothing is scaled or turned.
    const fades: number[] = [];
    for (let elapsed = 0; elapsed < SETTLED_MS; elapsed += STEP_MS) {
      act(() => {
        vi.advanceTimersByTime(STEP_MS);
      });
      const faded = screen
        .getByTestId(STATES.idle.testID)
        .parentElement?.closest<HTMLElement>('[style*="opacity"]');
      fades.push(faded === null || faded === undefined ? 1 : Number(faded.style.opacity));
      expect(stampScale(screen.getByTestId(STATES.idle.testID))).toBe(1);
    }
    expect(Math.min(...fades)).toBeLessThan(1);
    expect(fades.at(-1)).toBe(1);
    expect(document.querySelectorAll('[style*="rotate"]')).toHaveLength(0);
  });

  it('named with its subject', () => {
    const idle = draw(STATES.idle);
    expect(idle.getAttribute('aria-label')).toBe('Follow Carol Wynn');
    expect(idle.textContent).toBe('Follow');
    expect(idle.getAttribute('aria-pressed')).toBe('false');
    expect(nativeProps()['accessibilityHint']).toBeUndefined();

    const following = draw(STATES.following);
    expect(following.getAttribute('aria-label')).toBe('Following Carol Wynn');
    expect(following.textContent).toBe('Following');
    expect(following.getAttribute('aria-pressed')).toBe('true');
    expect(nativeProps()['accessibilityState']).toMatchObject({ selected: true });
    expect(nativeProps()['accessibilityHint']).toBe('Press to stop following');

    // The name follows whoever the button is for.
    expect(draw({ ...STATES.idle, subject: 'Dana Okafor' }).getAttribute('aria-label')).toBe(
      'Follow Dana Okafor',
    );
  });

  it('one width in both states', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const button = draw(fixture);
      const { hug, twin } = lockOf(button);
      // Under each state stands what the other draws, with no height and never read.
      expect(twin.textContent, state).toBe(fixture.following ? 'Follow' : 'Following');
      expect(
        [...twin.querySelectorAll('path')].map((path) => path.getAttribute('d')),
        state,
      ).toEqual(fixture.following ? [] : [CHECK]);
      expect(twin.style.height, state).toBe('0px');
      expect(twin.style.overflow, state).toBe('hidden');
      expect(twin.getAttribute('aria-hidden'), state).toBe('true');
      // The twin's box is the button's: its side padding and the outline's width.
      const box = twin.firstElementChild;
      expect(box instanceof HTMLElement ? box.style.paddingLeft : '', state).toBe(
        `${String((fixture.size === 'sm' ? space.x3 : space.x4) + rule.hairline)}px`,
      );
      expect(box instanceof HTMLElement ? box.style.columnGap : '', state).toBe(
        `${String(space.x2)}px`,
      );
      // The lock hugs the wider of the two, and the button fills it.
      expect(hug.style.alignSelf, state).toBe('flex-start');
      expect(button.parentElement?.style.alignSelf, state).toBe('stretch');
    }
  });

  it('stamps and plays the medium haptic only when turning on', () => {
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    cleanup();
    const id = STATES.idle.testID;
    const { rerender } = renderWithProviders(<Live fixture={STATES.idle} />);
    // A mount plays nothing.
    expect(watch(SETTLED_MS, id).every((value) => value === 1)).toBe(true);

    fireEvent.click(screen.getByTestId(id));
    const landing = watch(SETTLED_MS, id);
    expect(Math.max(...landing)).toBeGreaterThan(1);
    expect(Math.max(...landing)).toBeLessThanOrEqual(motion.scale.done);
    expect(landing.at(-1)).toBe(1);
    expect(hapticsFake.calls).toEqual([{ method: 'impact', weight: 'medium' }]);

    // Undoing cuts back: no stamp, no haptic.
    vi.advanceTimersByTime(HAPTIC_GAP_MS);
    fireEvent.click(screen.getByTestId(id));
    expect(screen.getByTestId(id).textContent).toBe('Follow');
    expect(watch(SETTLED_MS, id).every((value) => value === 1)).toBe(true);
    expect(hapticsFake.calls).toHaveLength(1);

    // A button handed another person who is already followed plays nothing.
    rerender(<Live fixture={{ ...STATES.following, itemKey: 'another-person' }} />);
    expect(watch(SETTLED_MS, STATES.following.testID).every((value) => value === 1)).toBe(true);
    expect(hapticsFake.calls).toHaveLength(1);
  });
});
