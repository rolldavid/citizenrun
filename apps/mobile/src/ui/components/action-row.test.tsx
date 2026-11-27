import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { createElement, useState } from 'react';
import type { JSX, ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';
import { color, gutter, rule, size, space, z } from '@/ui/tokens';

import { ActionRow } from './action-row';
import type { ActionRowProps } from './action-row';
import { GROUND, PREVIEW, STATES } from './action-row.fixtures';

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

// The window the row reads: a phone unless a case sets another, tight or not as a case sets it.
const layout = vi.hoisted(() => {
  const state: { width: number; isTight: boolean } = { width: 360, isTight: false };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout => ({
      ...actual.layoutFor({ width: layout.width, height: 900, fontScale: 1, topBarHeight: 0 }),
      isTight: layout.isTight,
    }),
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'rowHidden',
  'rowHiddenDone',
  'rowIdle',
  'rowRunning',
  'rowUnavailable',
  'sticky',
  'stickyDone',
  'stickyHidden',
  'stacked',
  'stackedHidden',
  'withPartTestIDs',
] as const;

const ALL: Readonly<Record<StateName, ActionRowProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const RUN_LONG = 'Run for this office';
const CHECK = 'M5 12.500 10 17.500 19 7';
const BOOKMARK = 'M7 4h10v16l-5-4-5 4z';
/** A frame, and a step shorter than one so no frame of a run is missed. */
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

/** The ids of a row's three parts. */
function ids(props: ActionRowProps): { run: string; follow: string; bookmark: string } {
  return {
    run: props.partTestIDs?.run ?? `${props.testID}-run`,
    follow: props.partTestIDs?.follow ?? `${props.testID}-follow`,
    bookmark: props.partTestIDs?.bookmark ?? `${props.testID}-bookmark`,
  };
}

/** Renders one row, in place of whatever was drawn before, and gives back its root. */
function draw(props: ActionRowProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  pressables.props = [];
  renderWithProviders(<ActionRow {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** The props C-Pressable gave the native Pressable of one part. */
function nativeProps(testID: string): Record<string, unknown> {
  const found = pressables.props.findLast((props) => props['testID'] === testID);
  if (found === undefined) {
    throw new Error(`no native Pressable was rendered for ${testID}`);
  }
  return found;
}

/** The visible words of a button: its label, without the hidden twin under it. */
function wordsOf(button: HTMLElement): string {
  return button.textContent;
}

/** The zero-height copy of a control's other state, found from the control. */
function twinOf(control: HTMLElement, root: HTMLElement): HTMLElement | null {
  for (
    let part = control.parentElement;
    part !== null && part !== root;
    part = part.parentElement
  ) {
    const twin = [...part.children].find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.style.height === '0px' && !child.contains(control),
    );
    if (twin !== undefined) {
      return twin;
    }
  }
  return null;
}

/** What fixes the size of each slot of a row, in order: its flex, its width and its twin's box. */
function slotShapes(props: ActionRowProps): string[] {
  const root = draw(props);
  const controls = [ids(props).run, ids(props).follow, ids(props).bookmark]
    .map((id) => screen.queryByTestId(id))
    .filter((control) => control !== null);
  return controls.map((control) => {
    let slot: HTMLElement = control;
    while (slot.parentElement !== null && slot.parentElement !== root) {
      // In the stacked layout the second row holds two slots; a slot is the child of its row.
      if (slot.parentElement.style.flexDirection === 'row' && slot.parentElement !== root) {
        break;
      }
      slot = slot.parentElement;
    }
    const twin = twinOf(control, root);
    const box = twin?.firstElementChild;
    return JSON.stringify({
      grow: slot.style.flexGrow,
      shrink: slot.style.flexShrink,
      basis: slot.style.flexBasis,
      width: slot.style.width,
      twin:
        twin === null
          ? null
          : {
              height: twin.style.height,
              overflow: twin.style.overflow,
              hidden: twin.getAttribute('aria-hidden'),
              padding: box instanceof HTMLElement ? box.style.paddingLeft : null,
            },
    });
  });
}

/** The scale the stamp holds a control at: 1 at rest. */
function stampScale(control: HTMLElement, root: HTMLElement): number {
  for (
    let part = control.parentElement;
    part !== null && part !== root;
    part = part.parentElement
  ) {
    const found = /scale\(([0-9.]+)\) rotate/.exec(part.style.transform);
    if (found?.[1] !== undefined) {
      return Number(found[1]);
    }
  }
  return 1;
}

/** The opacity of the view the stamp fades under reduced motion: 1 at rest. */
function stampFade(control: HTMLElement, root: HTMLElement): number {
  for (
    let part = control.parentElement;
    part !== null && part !== root;
    part = part.parentElement
  ) {
    if (part.style.opacity !== '') {
      return Number(part.style.opacity);
    }
  }
  return 1;
}

/** What `read` gives at each step of `ms`. */
function watch(ms: number, read: () => number): number[] {
  const seen: number[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
    act(() => {
      vi.advanceTimersByTime(STEP_MS);
    });
    seen.push(read());
  }
  return seen;
}

/** A row that holds its own truth, as a screen does: a press follows or bookmarks, and undoes it. */
function Live({ fixture }: { fixture: ActionRowProps }): JSX.Element {
  const [following, setFollowing] = useState(fixture.following);
  const [bookmarked, setBookmarked] = useState(fixture.bookmarked);
  return (
    <ActionRow
      {...fixture}
      following={following}
      bookmarked={bookmarked}
      onToggleFollow={() => {
        setFollowing(!following);
      }}
      onToggleBookmark={() => {
        setBookmarked(!bookmarked);
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
  layout.width = 360;
  layout.isTight = false;
});

describe('ActionRow', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const fixture = ALL[state];
          const root = draw(fixture, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const part = ids(fixture);
          // Follow and Bookmark always; Run unless it is hidden. Never a fourth action.
          const buttons = within(root).getAllByRole('button');
          expect(buttons, name).toHaveLength(fixture.run.state === 'hidden' ? 2 : 3);
          expect(screen.queryByTestId(part.run) !== null, name).toBe(
            fixture.run.state !== 'hidden',
          );
          const follow = screen.getByTestId(part.follow);
          const bookmark = screen.getByTestId(part.bookmark);
          // Left to right: Run, Follow, Bookmark.
          expect(buttons.at(-2), name).toBe(follow);
          expect(buttons.at(-1), name).toBe(bookmark);
          // Follow is an outline, and ink with the check once following. Never a color.
          const box = follow.querySelector<HTMLElement>('[style*="min-height"]');
          expect(box?.style.backgroundColor, name).toBe(
            fixture.following ? written(color[theme].inverseBg) : '',
          );
          expect(wordsOf(follow), name).toBe(fixture.following ? 'Following' : 'Follow');
          // Bookmark is the icon alone: never framed, filled once bookmarked.
          expect(bookmark.textContent, name).toBe('');
          expect(bookmark.querySelector('[style*="border-width"]'), name).toBeNull();
          expect(bookmark.querySelector('path')?.getAttribute('d'), name).toBe(BOOKMARK);
          expect(bookmark.querySelector('path')?.getAttribute('fill') !== 'none', name).toBe(
            fixture.bookmarked,
          );
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the eleven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].kind, state).toBe('office');
      expect(ALL[state].itemKey, state).toBe('fixture-office');
    }
    expect(STATES.rowHidden.run).toEqual({ state: 'hidden' });
    expect(STATES.rowHiddenDone).toMatchObject({ following: true, bookmarked: true });
    expect(STATES.rowIdle.run).toEqual({ state: 'idle' });
    expect(STATES.rowRunning.run).toEqual({ state: 'running' });
    expect(STATES.rowUnavailable.run).toEqual({ state: 'unavailable', label: 'Filing closed' });
    expect(STATES.sticky).toMatchObject({ layout: 'sticky', run: { state: 'idle' } });
    expect(STATES.stickyDone).toMatchObject({
      layout: 'sticky',
      following: true,
      bookmarked: true,
    });
    expect(STATES.stickyHidden).toMatchObject({ layout: 'sticky', run: { state: 'hidden' } });
    expect(STATES.stacked).toMatchObject({ layout: 'stacked', run: { state: 'idle' } });
    expect(STATES.stackedHidden).toMatchObject({ layout: 'stacked', run: { state: 'hidden' } });
    expect(STATES.withPartTestIDs.testID).toBe('office.actions');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const root = draw(fixture);
      const part = ids(fixture);
      // The row is no group of its own: three buttons, each with a name.
      expect(root.getAttribute('role'), state).toBeNull();
      for (const button of within(root).getAllByRole('button')) {
        expect(button.getAttribute('aria-label') ?? '', state).not.toBe('');
      }
      expect(screen.getByTestId(part.follow).getAttribute('aria-label'), state).toBe(
        fixture.following ? 'Following' : 'Follow',
      );
      expect(screen.getByTestId(part.bookmark).getAttribute('aria-label'), state).toBe(
        fixture.bookmarked ? 'Bookmarked' : 'Bookmark',
      );
      // The twin under a button is never read.
      for (const hidden of root.querySelectorAll('[aria-hidden="true"]')) {
        expect(hidden.querySelectorAll('[role], [aria-label]'), state).toHaveLength(0);
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const fixture = ALL[state];
      const root = draw(fixture);
      expect(fixture.testID, state).toMatch(TEST_ID);
      expect(root.getAttribute('data-testid'), state).toBe(fixture.testID);
      if (state !== 'withPartTestIDs') {
        expect(fixture.testID, state).toMatch(/^gallery\.action-row-/);
      }
      // Everything a person can press carries an id.
      for (const button of within(root).getAllByRole('button')) {
        expect(button.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    cleanup();
    renderWithProviders(<Live fixture={STATES.rowHidden} />, { reducedMotion: true });
    const root = screen.getByTestId(STATES.rowHidden.testID);
    const part = ids(STATES.rowHidden);
    fireEvent.click(screen.getByTestId(part.follow));
    // The done state fades in where it stands: nothing is scaled or turned.
    const fades = watch(SETTLED_MS, () => stampFade(screen.getByTestId(part.follow), root));
    expect(Math.min(...fades)).toBeLessThan(1);
    expect(fades.at(-1)).toBe(1);
    for (const moved of root.querySelectorAll<HTMLElement>('[style*="rotate"]')) {
      expect(moved.style.transform).toBe('');
    }
    expect(stampScale(screen.getByTestId(part.follow), root)).toBe(1);
    // The commitment is still felt.
    expect(hapticsFake.calls).toEqual([{ method: 'impact', weight: 'medium' }]);
  });

  it('Run hidden gives Follow two slots', () => {
    const root = draw(STATES.rowHidden);
    const part = ids(STATES.rowHidden);
    // No Run: Follow, then Bookmark.
    expect(screen.queryByTestId(part.run)).toBeNull();
    expect(root.children).toHaveLength(2);
    const [followSlot, bookmarkSlot] = [...root.children];
    if (!(followSlot instanceof HTMLElement) || !(bookmarkSlot instanceof HTMLElement)) {
      throw new Error('the row draws no slots');
    }
    expect(followSlot.contains(screen.getByTestId(part.follow))).toBe(true);
    expect(followSlot.style.flexGrow).toBe('2');
    expect(bookmarkSlot.contains(screen.getByTestId(part.bookmark))).toBe(true);
    expect(bookmarkSlot.style.width).toBe(`${String(size.target)}px`);
    expect(bookmarkSlot.style.flexGrow).toBe('');
    // The row: 60 points at least, 8 above and below, 8 between slots, the screen's gutter at compact.
    expect(root.style.flexDirection).toBe('row');
    expect(root.style.minHeight).toBe(`${String(size.actionRow)}px`);
    expect(root.style.paddingTop).toBe(`${String(space.x2)}px`);
    expect(root.style.columnGap).toBe(`${String(space.x2)}px`);
    expect(root.style.paddingLeft).toBe(`${String(gutter.narrow)}px`);
    // From medium up the feed column brings its own.
    layout.width = 1440;
    expect(draw(STATES.rowHidden).style.paddingLeft).toBe(`${String(gutter.feedColumnWide)}px`);
    layout.width = 360;

    // With Run, the two are equal slots and Bookmark keeps its own.
    const three = draw(STATES.rowIdle);
    expect(three.children).toHaveLength(3);
    const grows = [...three.children].map((slot) =>
      slot instanceof HTMLElement ? slot.style.flexGrow : null,
    );
    expect(grows).toEqual(['1', '1', '']);
    expect(three.children[2] instanceof HTMLElement ? three.children[2].style.width : '').toBe(
      `${String(size.target)}px`,
    );
  });

  it('Run is named in full', () => {
    for (const state of ['rowIdle', 'sticky', 'stacked', 'rowRunning', 'rowUnavailable'] as const) {
      draw(STATES[state]);
      const run = screen.getByTestId(ids(STATES[state]).run);
      expect(run.getAttribute('aria-label'), state).toBe(RUN_LONG);
      expect(screen.getByRole('button', { name: RUN_LONG }), state).toBe(run);
      // Never an icon on Run, but the check of its done state.
      expect(run.querySelectorAll('path'), state).toHaveLength(state === 'rowRunning' ? 1 : 0);
    }
    // Under a card the word is short; in the bar and the action card it is the sentence.
    draw(STATES.rowIdle);
    expect(wordsOf(screen.getByTestId(ids(STATES.rowIdle).run))).toBe('Run');
    draw(STATES.sticky);
    expect(wordsOf(screen.getByTestId(ids(STATES.sticky).run))).toBe(RUN_LONG);
    draw(STATES.stacked);
    expect(wordsOf(screen.getByTestId(ids(STATES.stacked).run))).toBe(RUN_LONG);
    // The bar's Run shortens where the window is tight; its name does not.
    layout.isTight = true;
    draw(STATES.sticky);
    const tight = screen.getByTestId(ids(STATES.sticky).run);
    expect(wordsOf(tight)).toBe('Run');
    expect(tight.getAttribute('aria-label')).toBe(RUN_LONG);
    layout.isTight = false;

    // Idle is the accent button; it opens the way to run and holds no state.
    draw(STATES.rowIdle);
    const idle = screen.getByTestId(ids(STATES.rowIdle).run);
    expect(idle.getAttribute('aria-pressed')).toBeNull();
    expect(idle.querySelector<HTMLElement>('[style*="min-height"]')?.style.backgroundColor).toBe(
      written(color.light.accent),
    );
    // Running is the ink button with the check, and is selected.
    draw(STATES.rowRunning);
    const running = screen.getByTestId(ids(STATES.rowRunning).run);
    expect(wordsOf(running)).toBe('Running');
    expect(running.getAttribute('aria-pressed')).toBe('true');
    expect(running.querySelector('path')?.getAttribute('d')).toBe(CHECK);
    expect(running.querySelector<HTMLElement>('[style*="min-height"]')?.style.backgroundColor).toBe(
      written(color.light.inverseBg),
    );
    expect(nativeProps(ids(STATES.rowRunning).run)['accessibilityState']).toMatchObject({
      selected: true,
    });
    // Unavailable says why on a disabled button: never dashed, never hidden.
    const onRun = vi.fn();
    draw({ ...STATES.rowUnavailable, onRun });
    const closed = screen.getByTestId(ids(STATES.rowUnavailable).run);
    expect(wordsOf(closed)).toBe('Filing closed');
    expect(closed.getAttribute('aria-disabled')).toBe('true');
    const closedBox = closed.querySelector<HTMLElement>('[style*="min-height"]');
    expect(closedBox?.style.backgroundColor).toBe(written(color.light.disabledBg));
    expect(closedBox?.style.borderStyle).not.toBe('dashed');
    expect(nativeProps(ids(STATES.rowUnavailable).run)['accessibilityHint']).toBe('Filing closed');
    fireEvent.click(closed);
    expect(onRun).not.toHaveBeenCalled();
    // A press on Run reaches the caller, with no haptic of the row's.
    const pressed = vi.fn();
    draw({ ...STATES.rowIdle, onRun: pressed });
    fireEvent.click(screen.getByTestId(ids(STATES.rowIdle).run));
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(hapticsFake.calls).toEqual([]);
  });

  it('Follow and Bookmark names and states', () => {
    draw(STATES.rowHiddenDone);
    const done = ids(STATES.rowHiddenDone);
    const follow = screen.getByTestId(done.follow);
    expect(screen.getByRole('button', { name: 'Following' })).toBe(follow);
    expect(wordsOf(follow)).toBe('Following');
    expect(follow.getAttribute('aria-pressed')).toBe('true');
    expect(follow.querySelector('path')?.getAttribute('d')).toBe(CHECK);
    expect(nativeProps(done.follow)['accessibilityHint']).toBe('Press to stop following');
    expect(nativeProps(done.follow)['accessibilityState']).toMatchObject({ selected: true });
    const bookmark = screen.getByTestId(done.bookmark);
    expect(screen.getByRole('button', { name: 'Bookmarked' })).toBe(bookmark);
    expect(bookmark.getAttribute('aria-pressed')).toBe('true');
    expect(nativeProps(done.bookmark)['accessibilityState']).toMatchObject({ selected: true });

    draw(STATES.rowHidden);
    const idle = ids(STATES.rowHidden);
    const unfollowed = screen.getByTestId(idle.follow);
    expect(screen.getByRole('button', { name: 'Follow' })).toBe(unfollowed);
    expect(unfollowed.getAttribute('aria-pressed')).toBe('false');
    expect(unfollowed.querySelectorAll('path')).toHaveLength(0);
    expect(nativeProps(idle.follow)['accessibilityHint']).toBeUndefined();
    const unmarked = screen.getByTestId(idle.bookmark);
    expect(screen.getByRole('button', { name: 'Bookmark' })).toBe(unmarked);
    expect(unmarked.getAttribute('aria-pressed')).toBe('false');

    // A press reaches the caller; the row holds no truth of its own.
    const onToggleFollow = vi.fn();
    const onToggleBookmark = vi.fn();
    draw({ ...STATES.rowHidden, onToggleFollow, onToggleBookmark });
    fireEvent.click(screen.getByTestId(idle.follow));
    fireEvent.click(screen.getByTestId(idle.bookmark));
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
    expect(wordsOf(screen.getByTestId(idle.follow))).toBe('Follow');
  });

  it('slots keep their size', () => {
    // A done state changes nothing that sizes a slot.
    expect(slotShapes(STATES.rowHiddenDone)).toEqual(slotShapes(STATES.rowHidden));
    expect(slotShapes(STATES.rowRunning)).toEqual(slotShapes(STATES.rowIdle));
    expect(slotShapes(STATES.stickyDone)).toEqual(slotShapes(STATES.sticky));
    expect(slotShapes({ ...STATES.sticky, run: { state: 'running' } })).toEqual(
      slotShapes(STATES.sticky),
    );
    expect(slotShapes({ ...STATES.stacked, run: { state: 'running' } })).toEqual(
      slotShapes(STATES.stacked),
    );

    // Under Follow stands what its other state draws: no height, never seen, never read.
    const idleRoot = draw(STATES.rowHidden);
    const idleFollow = screen.getByTestId(ids(STATES.rowHidden).follow);
    const idleTwin = twinOf(idleFollow, idleRoot);
    expect(idleTwin?.style.height).toBe('0px');
    expect(idleTwin?.style.overflow).toBe('hidden');
    expect(idleTwin?.getAttribute('aria-hidden')).toBe('true');
    expect(idleTwin?.textContent).toBe('Following');
    expect(idleTwin?.querySelector('path')?.getAttribute('d')).toBe(CHECK);
    // The twin's box is the button's: 16 at each side and the outline's width.
    const idleBox = idleTwin?.firstElementChild;
    expect(idleBox instanceof HTMLElement ? idleBox.style.paddingLeft : '').toBe(
      `${String(space.x4 + rule.hairline)}px`,
    );
    expect(idleBox instanceof HTMLElement ? idleBox.style.columnGap : '').toBe(
      `${String(space.x2)}px`,
    );
    // The button fills the lock, so it is as wide as the wider of the two.
    expect(idleFollow.parentElement?.style.alignSelf).toBe('stretch');

    const doneRoot = draw(STATES.rowHiddenDone);
    const doneTwin = twinOf(screen.getByTestId(ids(STATES.rowHiddenDone).follow), doneRoot);
    expect(doneTwin?.textContent).toBe('Follow');
    expect(doneTwin?.querySelectorAll('path')).toHaveLength(0);

    // Run is locked the same way in the bar and the action card, where it is not an equal slot.
    for (const state of ['sticky', 'stacked'] as const) {
      const root = draw(STATES[state]);
      const twin = twinOf(screen.getByTestId(ids(STATES[state]).run), root);
      expect(twin?.textContent, state).toBe('Running');
      const running = draw({ ...STATES[state], run: { state: 'running' } });
      expect(twinOf(screen.getByTestId(ids(STATES[state]).run), running)?.textContent, state).toBe(
        RUN_LONG,
      );
    }
    // Under a card the slots are equal whatever they hold, and Run needs no twin.
    const row = draw(STATES.rowIdle);
    expect(twinOf(screen.getByTestId(ids(STATES.rowIdle).run), row)).toBeNull();
    // Bookmark's slot is its target: it has no words to lock.
    expect(twinOf(screen.getByTestId(ids(STATES.rowIdle).bookmark), row)).toBeNull();
  });

  it('part ids', () => {
    const named = draw(STATES.withPartTestIDs);
    expect(named.getAttribute('data-testid')).toBe('office.actions');
    expect(within(named).getByTestId('office.run-button').getAttribute('aria-label')).toBe(
      RUN_LONG,
    );
    expect(within(named).getByTestId('office.follow-button').getAttribute('aria-label')).toBe(
      'Follow',
    );
    expect(within(named).getByTestId('office.bookmark-button').getAttribute('aria-label')).toBe(
      'Bookmark',
    );
    expect(screen.queryByTestId('office.actions-run')).toBeNull();

    // Without them each part takes the row's id and its own name.
    const derived = draw(STATES.rowIdle);
    for (const part of ['run', 'follow', 'bookmark'] as const) {
      expect(within(derived).getByTestId(`gallery.action-row-row-idle-${part}`)).toBeDefined();
    }
    // A screen may name one part and leave the rest.
    const mixed = draw({ ...STATES.rowIdle, partTestIDs: { follow: 'office.follow-button' } });
    expect(within(mixed).getByTestId('office.follow-button')).toBeDefined();
    expect(within(mixed).getByTestId('gallery.action-row-row-idle-run')).toBeDefined();
    expect(within(mixed).getByTestId('gallery.action-row-row-idle-bookmark')).toBeDefined();
  });

  it('stamp and haptic only when turning on', () => {
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    cleanup();
    const part = ids(STATES.rowHidden);
    const { rerender } = renderWithProviders(<Live fixture={STATES.rowHidden} />);
    const root = screen.getByTestId(STATES.rowHidden.testID);
    const followScale = (): number => stampScale(screen.getByTestId(part.follow), root);
    const bookmarkScale = (): number => stampScale(screen.getByTestId(part.bookmark), root);
    // A mount plays nothing.
    expect(watch(SETTLED_MS, followScale).every((value) => value === 1)).toBe(true);

    // Follow: the done state lands from the done scale, once, with the medium haptic.
    fireEvent.click(screen.getByTestId(part.follow));
    expect(wordsOf(screen.getByTestId(part.follow))).toBe('Following');
    const landing = watch(SETTLED_MS, followScale);
    expect(Math.max(...landing)).toBeGreaterThan(1);
    expect(Math.max(...landing)).toBeLessThanOrEqual(motion.scale.done);
    expect(landing.at(-1)).toBe(1);
    expect(watch(SETTLED_MS, followScale).every((value) => value === 1)).toBe(true);
    expect(hapticsFake.calls).toEqual([{ method: 'impact', weight: 'medium' }]);
    // Its neighbour did not stamp with it.
    expect(bookmarkScale()).toBe(1);

    // Undoing cuts back: no stamp, no haptic.
    vi.advanceTimersByTime(HAPTIC_GAP_MS);
    fireEvent.click(screen.getByTestId(part.follow));
    expect(wordsOf(screen.getByTestId(part.follow))).toBe('Follow');
    expect(watch(SETTLED_MS, followScale).every((value) => value === 1)).toBe(true);
    expect(hapticsFake.calls).toEqual([{ method: 'impact', weight: 'medium' }]);

    // Bookmark: the filled icon lands the same way with the light haptic, and its undo is still.
    fireEvent.click(screen.getByTestId(part.bookmark));
    expect(screen.getByTestId(part.bookmark).getAttribute('aria-label')).toBe('Bookmarked');
    const marked = watch(SETTLED_MS, bookmarkScale);
    expect(Math.max(...marked)).toBeGreaterThan(1);
    expect(marked.at(-1)).toBe(1);
    expect(followScale()).toBe(1);
    expect(hapticsFake.calls).toEqual([
      { method: 'impact', weight: 'medium' },
      { method: 'impact', weight: 'light' },
    ]);
    vi.advanceTimersByTime(HAPTIC_GAP_MS);
    fireEvent.click(screen.getByTestId(part.bookmark));
    expect(watch(SETTLED_MS, bookmarkScale).every((value) => value === 1)).toBe(true);
    expect(hapticsFake.calls).toHaveLength(2);

    // A row that arrives done, as a list's row handed another office does, plays nothing.
    rerender(<Live fixture={{ ...STATES.rowHiddenDone, itemKey: 'another-office' }} />);
    const other = screen.getByTestId(STATES.rowHiddenDone.testID);
    const arrived = watch(SETTLED_MS, () =>
      stampScale(screen.getByTestId(ids(STATES.rowHiddenDone).follow), other),
    );
    expect(arrived.every((value) => value === 1)).toBe(true);
    expect(hapticsFake.calls).toHaveLength(2);
  });

  it('a done state a screen sets stamps without a press', () => {
    vi.useFakeTimers();
    vi.setSystemTime(clock);
    cleanup();
    const part = ids(STATES.rowHidden);
    const { rerender } = renderWithProviders(<ActionRow {...STATES.rowHidden} />);
    const root = screen.getByTestId(STATES.rowHidden.testID);
    const followScale = (): number => stampScale(screen.getByTestId(part.follow), root);
    rerender(<ActionRow {...STATES.rowHidden} following={true} />);
    const landing = watch(SETTLED_MS, followScale);
    expect(Math.max(...landing)).toBeGreaterThan(1);
    expect(landing.at(-1)).toBe(1);
    // The same props again start no second run, and turning off plays nothing.
    rerender(<ActionRow {...STATES.rowHidden} following={true} />);
    expect(watch(SETTLED_MS, followScale).every((value) => value === 1)).toBe(true);
    rerender(<ActionRow {...STATES.rowHidden} following={false} />);
    expect(watch(SETTLED_MS, followScale).every((value) => value === 1)).toBe(true);
    // The haptic belongs to the press.
    expect(hapticsFake.calls).toEqual([]);
  });

  it('the sticky bar fills the bottom inset', () => {
    const inset = { top: 47, right: 0, bottom: 34, left: 0 };
    const within34 = (props: ActionRowProps): HTMLElement => {
      cleanup();
      renderWithProviders(
        <SafeAreaInsetsContext.Provider value={inset}>
          <ActionRow {...props} />
        </SafeAreaInsetsContext.Provider>,
      );
      return screen.getByTestId(props.testID);
    };
    const bar = within34(STATES.sticky);
    expect(bar.style.paddingBottom).toBe(`${String(space.x3 + 34)}px`);
    expect(bar.style.paddingTop).toBe(`${String(space.x3)}px`);
    // The page's ground under a hairline, above the content it stands over.
    expect(bar.style.backgroundColor).toBe(written(color.light.bg));
    expect(bar.style.borderTopWidth).toBe(`${String(rule.hairline)}px`);
    expect(bar.style.borderTopColor).toBe(written(color.light.rule));
    expect(bar.style.zIndex).toBe(String(z.sticky));
    expect(bar.style.paddingLeft).toBe(`${String(gutter.narrow)}px`);
    // With no inset the bar keeps its own 12.
    expect(draw(STATES.sticky).style.paddingBottom).toBe(`${String(space.x3)}px`);
    // No other layout reads the inset.
    expect(within34(STATES.rowIdle).style.paddingBottom).toBe(`${String(space.x2)}px`);
    expect(within34(STATES.stacked).style.paddingBottom).toBe('');

    // Run takes the free width, Follow its locked width, Bookmark its slot.
    const three = draw(STATES.sticky);
    const shapes = [...three.children].map((slot) =>
      slot instanceof HTMLElement
        ? [slot.style.flexGrow, slot.style.flexShrink, slot.style.width]
        : [],
    );
    expect(shapes).toEqual([
      ['1', '1', ''],
      ['', '0', ''],
      ['', '', `${String(size.target)}px`],
    ]);
    // Without Run, Follow takes the free width.
    const two = draw(STATES.stickyHidden);
    expect(two.children).toHaveLength(2);
    expect(two.children[0] instanceof HTMLElement ? two.children[0].style.flexGrow : '').toBe('1');

    // The action card: Run across the card, then Follow and Bookmark on a second row.
    const card = draw(STATES.stacked);
    expect(card.style.rowGap).toBe(`${String(space.x2)}px`);
    expect(card.children).toHaveLength(2);
    expect(card.children[0]?.contains(screen.getByTestId(ids(STATES.stacked).run))).toBe(true);
    expect(card.children[1]?.contains(screen.getByTestId(ids(STATES.stacked).follow))).toBe(true);
    expect(card.children[1]?.contains(screen.getByTestId(ids(STATES.stacked).bookmark))).toBe(true);
    // Without Run the first row is not drawn.
    expect(draw(STATES.stackedHidden).children).toHaveLength(1);
  });
});
