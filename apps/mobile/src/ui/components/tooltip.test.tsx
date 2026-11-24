import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { View } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import type { KeyEventLike } from '@/ui/shortcuts';
import { color, gesture, radius, size, space, z } from '@/ui/tokens';

import { Pressable } from './pressable';
import { Tooltip } from './tooltip';
import type { TooltipProps } from './tooltip';
import { GROUND, PREVIEW, STATES } from './tooltip.fixtures';

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

const EXPANDED = [1440, 900] as const;

const PROBE = 'probe.tooltip';
const OTHER = 'probe.other';
const WORDS = 'Bookmark';

beforeEach(() => {
  vi.useFakeTimers();
  setViewport(...EXPANDED);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** A control with a tooltip: a clear square that is named as the tooltip names it. */
function Probe({ text, testID }: { text: string; testID: string }): TooltipProps['children'] {
  return (
    <Tooltip text={text}>
      <Pressable role="button" label={text} testID={testID} onPress={() => undefined}>
        <View style={{ width: size.target, height: size.target }} />
      </Pressable>
    </Tooltip>
  );
}

/** Renders the probe, in place of whatever was drawn before, and gives back its control. */
function draw(options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<Probe text={WORDS} testID={PROBE} />, options);
  return screen.getByTestId(PROBE);
}

/** The bubbles showing now, by their words. A control's name is a label, never text. */
function bubbles(words: string = WORDS): HTMLElement[] {
  return screen.queryAllByText(words);
}

type Shown = {
  /** The words' own element. */
  words: HTMLElement;
  /** The ink box round the words. */
  box: HTMLElement;
  /** The clear box under the control that the bubble is laid out in. */
  anchor: HTMLElement;
  /** The view round the control and its bubble, as large as the control. */
  holder: HTMLElement;
  /** The view that takes the control's place in its parent. */
  wrapper: HTMLElement;
};

/** The one bubble showing now, with the boxes round it. */
function shown(words: string = WORDS): Shown {
  const found = bubbles(words);
  if (found.length !== 1 || found[0] === undefined) {
    throw new Error(`expected one bubble, found ${String(found.length)}`);
  }
  const anchor = found[0].closest<HTMLElement>('[aria-hidden="true"]');
  const box = anchor?.firstElementChild;
  const holder = anchor?.parentElement;
  const wrapper = holder?.parentElement;
  if (!(anchor instanceof HTMLElement) || !(box instanceof HTMLElement) || !holder || !wrapper) {
    throw new Error('the bubble is missing a part');
  }
  return { words: found[0], box, anchor, holder, wrapper };
}

/** Lets a wait run. */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Lets the page answer the measure a showing bubble asks for: it answers on the next turn. */
function measure(): void {
  wait(1);
}

function focus(control: HTMLElement): void {
  fireEvent.focus(control);
}

function enter(control: HTMLElement, pointerType: string): void {
  fireEvent.pointerEnter(control, { pointerType });
}

function escape(): void {
  const event: KeyEventLike = {
    key: 'Escape',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    inTextField: false,
    preventDefault: () => undefined,
  };
  act(() => {
    linksFake.emitKey(event);
  });
}

/** Says where the page drew an element, for the measure a showing bubble asks for. */
function placeAt(element: HTMLElement, left: number, width: number): void {
  element.getBoundingClientRect = () => new DOMRect(left, 0, width, size.target);
}

describe('Tooltip', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      cleanup();
      renderWithProviders(<Tooltip {...STATES.onIconButton} />, { theme });
      const control = screen.getByTestId('gallery.tooltip-target');
      expect(screen.getByRole('button', { name: 'Settings' })).toBe(control);
      // At rest the specimen is the control alone.
      expect(bubbles('Settings')).toHaveLength(0);
      focus(control);
      measure();
      // The button names itself with a tooltip of its own; one of the two shows.
      const { box, words } = shown('Settings');
      expect(box.style.backgroundColor, theme).toBe(written(color[theme].inverseBg));
      expect(words.style.color, theme).toBe(written(color[theme].inverseText));
      expect(box.style.opacity, theme).toBe('');
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the one state', () => {
    expect(Object.keys(STATES)).toEqual(['onIconButton']);
    expect(STATES.onIconButton.text).toBe('Settings');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('shows at once on focus', () => {
    const control = draw();
    expect(bubbles()).toHaveLength(0);
    focus(control);
    // No timer has run: the bubble is there, clear until the page says where the control is.
    expect(shown().box.style.opacity).toBe('0');
    measure();
    const { anchor, box, holder, wrapper } = shown();
    expect(box.style.opacity).toBe('');
    // The bubble: ink, the control radius, no arrow, under the control and above the page.
    expect(box.style.borderRadius).toBe(`${String(radius.control)}px`);
    expect(box.style.paddingTop).toBe(`${String(space.x1)}px`);
    expect(box.style.paddingBottom).toBe(`${String(space.x1)}px`);
    expect(box.style.paddingLeft).toBe(`${String(space.x2)}px`);
    expect(box.style.paddingRight).toBe(`${String(space.x2)}px`);
    expect(box.style.maxWidth).toBe('100%');
    expect(box.children).toHaveLength(1);
    expect(anchor.style.position).toBe('absolute');
    expect(anchor.style.top).toBe('100%');
    expect(anchor.style.marginTop).toBe(`${String(space.x2)}px`);
    expect(anchor.style.width).toBe(`${String(size.tooltipMax)}px`);
    expect(anchor.style.zIndex).toBe(String(z.popover));
    expect(window.getComputedStyle(anchor).pointerEvents).toBe('none');
    // The control stands above its neighbours while the bubble shows, and not before or after.
    expect(wrapper.style.zIndex).toBe(String(z.popover));
    // The bubble hangs from a view as large as the control, whatever the parent stretches.
    expect(holder.style.alignSelf).toBe('flex-start');
    expect(holder.contains(control)).toBe(true);
    fireEvent.blur(control);
    expect(wrapper.style.zIndex).toBe('');
  });

  it('lines up with the start of a control on the left and the end of one on the right', () => {
    const control = draw();
    focus(control);
    const holder = shown().holder;
    fireEvent.blur(control);

    placeAt(holder, size.rail, size.target);
    focus(control);
    measure();
    expect(shown().anchor.style.left).toBe('0px');
    expect(shown().anchor.style.right).toBe('');
    expect(shown().anchor.style.alignItems).toBe('flex-start');
    fireEvent.blur(control);

    placeAt(holder, EXPANDED[0] - size.target, size.target);
    focus(control);
    measure();
    expect(shown().anchor.style.right).toBe('0px');
    expect(shown().anchor.style.left).toBe('');
    expect(shown().anchor.style.alignItems).toBe('flex-end');
  });

  it('shows after the hover delay for a mouse', () => {
    const control = draw();
    enter(control, 'mouse');
    wait(gesture.tooltipHoverDelayMs - 1);
    expect(bubbles()).toHaveLength(0);
    wait(1);
    expect(bubbles()).toHaveLength(1);
    measure();
    expect(shown().box.style.opacity).toBe('');
  });

  it('a pointer that leaves before the delay shows nothing', () => {
    const control = draw();
    enter(control, 'mouse');
    wait(gesture.tooltipHoverDelayMs - 1);
    fireEvent.pointerLeave(control, { pointerType: 'mouse' });
    wait(gesture.tooltipHoverDelayMs);
    expect(bubbles()).toHaveLength(0);
  });

  it('never shows from a touch', () => {
    const control = draw();
    enter(control, 'touch');
    wait(gesture.tooltipHoverDelayMs * 2);
    expect(bubbles()).toHaveLength(0);
    // A touch that presses the control brings it the focus, and still shows nothing.
    fireEvent.pointerDown(control, { pointerType: 'touch' });
    focus(control);
    wait(gesture.tooltipHoverDelayMs * 2);
    expect(bubbles()).toHaveLength(0);
    // The keyboard reaches it afterwards as it always does.
    fireEvent.blur(control);
    focus(control);
    expect(bubbles()).toHaveLength(1);
  });

  it('hides on blur, pointer leave, press and Escape', () => {
    const control = draw();
    focus(control);
    expect(bubbles()).toHaveLength(1);
    fireEvent.blur(control);
    expect(bubbles()).toHaveLength(0);

    enter(control, 'mouse');
    wait(gesture.tooltipHoverDelayMs);
    expect(bubbles()).toHaveLength(1);
    fireEvent.pointerLeave(control, { pointerType: 'mouse' });
    expect(bubbles()).toHaveLength(0);

    enter(control, 'mouse');
    wait(gesture.tooltipHoverDelayMs);
    expect(bubbles()).toHaveLength(1);
    fireEvent.pointerDown(control, { pointerType: 'mouse' });
    expect(bubbles()).toHaveLength(0);
    // The focus that press brings shows nothing either.
    focus(control);
    expect(bubbles()).toHaveLength(0);
    fireEvent.blur(control);

    focus(control);
    expect(bubbles()).toHaveLength(1);
    escape();
    expect(bubbles()).toHaveLength(0);
  });

  it('is hidden from assistive technology', () => {
    const control = draw();
    focus(control);
    measure();
    const { anchor, words } = shown();
    expect(anchor.getAttribute('aria-hidden')).toBe('true');
    expect(anchor.contains(words)).toBe(true);
    expect(screen.queryByRole('tooltip')).toBeNull();
    // The control's own label carries the words: one name, said once.
    expect(screen.getAllByRole('button', { name: WORDS })).toEqual([control]);
    expect(control.getAttribute('aria-describedby')).toBeNull();
  });

  it('one tooltip shows at a time', () => {
    cleanup();
    renderWithProviders(
      <View>
        <Probe text={WORDS} testID={PROBE} />
        <Probe text="Share" testID={OTHER} />
      </View>,
    );
    enter(screen.getByTestId(PROBE), 'mouse');
    wait(gesture.tooltipHoverDelayMs);
    expect(bubbles()).toHaveLength(1);
    // The keyboard moves on while the pointer rests: the second takes the first's place.
    focus(screen.getByTestId(OTHER));
    expect(bubbles('Share')).toHaveLength(1);
    expect(bubbles()).toHaveLength(0);
  });
});
