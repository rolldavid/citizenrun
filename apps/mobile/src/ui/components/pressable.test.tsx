import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { cloneElement, createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { hitSlopFor, InteractionPreview, Pressable } from './pressable';
import type { InteractionPreviewState, PressableProps } from './pressable';
import { GROUND, PREVIEW, STATES } from './pressable.fixtures';
import { Text } from './text';

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

// The router's link hands `href`, the link role, `target` and `rel` to its one child as plain
// props, and the web's press target reads the last two only from its own anchor prop. This stand-in
// does what the router does, so the cases below see the anchor a browser would get.
vi.mock('expo-router', () => ({
  Link: (props: {
    href: string;
    target?: string;
    rel?: string;
    children: ReactElement;
  }): ReactElement =>
    cloneElement(props.children, {
      href: props.href,
      role: 'link',
      target: props.target,
      rel: props.rel,
    } as Record<string, unknown>), // the child's props are not known to the stand-in
}));

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'idle',
  'pressed',
  'hovered',
  'focused',
  'disabled',
  'fill',
  'fillPressed',
  'fillHovered',
  'small',
  'link',
] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.pressable';
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

const line = <Text role="body">Open the office</Text>;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one state of the fixtures, inside its preview when it has one. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): HTMLElement {
  cleanup();
  pressables.props = [];
  const element = <Pressable {...STATES[state]} />;
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
  return screen.getByTestId(STATES[state].testID);
}

type ProbeProps = Partial<PressableProps> & { preview?: InteractionPreviewState };

/** Renders one C-Pressable under the probe id, a button holding one line unless told otherwise. */
function draw(given: ProbeProps = {}, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  pressables.props = [];
  const { preview, ...props } = given;
  const element = (
    <Pressable role="button" label="Open the office" testID={PROBE} {...props}>
      {props.children ?? line}
    </Pressable>
  );
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
  return screen.getByTestId(PROBE);
}

/** The props C-Pressable gave the native Pressable. */
function nativeProps(): Record<string, unknown> {
  const found = pressables.props.at(-1);
  if (found === undefined) {
    throw new Error('no native Pressable was rendered');
  }
  return found;
}

/** The view that moves on press: the one that carries a transform. */
function mover(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>('[style*="transform"]');
}

/**
 * Presses a key on the focused element as a browser does. jsdom sends the key events and stops
 * there; a browser also clicks a focused native control: a button on Enter and on Space, an anchor
 * with an address on Enter. A key event the page has cancelled clicks nothing.
 */
function pressKey(element: HTMLElement, key: 'Enter' | ' '): void {
  act(() => {
    element.focus();
  });
  const allowed = fireEvent.keyDown(element, { key });
  const isButton = element.tagName === 'BUTTON';
  const isAnchor = element.tagName === 'A' && element.hasAttribute('href');
  if (allowed && (isButton || (isAnchor && key === 'Enter'))) {
    fireEvent.click(element);
  }
  fireEvent.keyUp(element, { key });
}

/** A mouse pointer entering or leaving the element, as the web's hover tracking hears it. */
function movePointer(element: HTMLElement, type: 'pointerenter' | 'pointerleave'): void {
  act(() => {
    element.dispatchEvent(new window.PointerEvent(type, { pointerType: 'mouse' }));
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Pressable', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const element = drawState(state, { theme });
        expect(element.textContent, state).toBe('Open the office');
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the ten states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({
      pressed: { pressed: true },
      hovered: { hovered: true },
      focused: { focused: true },
      fillPressed: { pressed: true },
      fillHovered: { hovered: true },
    });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const element = drawState(state);
      const { role, label } = STATES[state];
      expect(screen.getByRole(role, { name: label }), state).toBe(element);
      expect(element.getAttribute('role'), state).toBe(role);
      expect(element.getAttribute('aria-label'), state).toBe(label);
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const element = drawState(state);
      expect(element.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(element.getAttribute('data-testid'), state).toBe(`gallery.pressable-${kebab(state)}`);
    }
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      const element = drawState(state, { reducedMotion: true }, { pressed: true });
      for (const part of [element, ...element.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
      }
    }
    // The same press moves the content where motion is allowed.
    const moving = drawState('idle', {}, { pressed: true });
    expect(mover(moving)?.style.transform).toBe(MOVED);
  });

  it('a click presses once and plays the named haptic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const onPress = vi.fn();
    const element = draw({ onPress, haptic: 'light' });
    fireEvent.click(element);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith();
    expect(hapticsFake.calls).toEqual([{ method: 'impact', weight: 'light' }]);

    // Each haptic name reaches the platform module as its own call.
    vi.advanceTimersByTime(1000);
    fireEvent.click(draw({ onPress, haptic: 'success' }));
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(hapticsFake.calls).toEqual([
      { method: 'impact', weight: 'light' },
      { method: 'notify', kind: 'success' },
    ]);
  });

  it('a press without a haptic plays none', () => {
    const onPress = vi.fn();
    fireEvent.click(draw({ onPress }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hapticsFake.calls).toEqual([]);
  });

  it('disabled ignores presses, says so and leaves the Tab order', () => {
    const onPress = vi.fn();
    const element = draw({ onPress, haptic: 'light', disabled: true });
    fireEvent.click(element);
    pressKey(element, 'Enter');
    pressKey(element, ' ');
    expect(onPress).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
    expect(element.getAttribute('aria-disabled')).toBe('true');
    expect(element.getAttribute('tabindex')).toBe('-1');
    expect(nativeProps().disabled).toBe(true);
    expect(element.style.cursor).toBe('');

    const enabled = draw({ onPress });
    expect(enabled.getAttribute('aria-disabled')).toBeNull();
    expect(enabled.getAttribute('tabindex')).toBe('0');
    expect(enabled.style.cursor).toBe('pointer');
  });

  it('Enter and Space press a button, once each', () => {
    const onPress = vi.fn();
    const button = draw({ onPress });
    // A native button: the browser clicks it for both keys, and the page must not cancel either.
    expect(button.tagName).toBe('BUTTON');
    pressKey(button, 'Enter');
    expect(onPress).toHaveBeenCalledTimes(1);
    pressKey(button, ' ');
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('Enter follows a link and Space does not press it', () => {
    const onPress = vi.fn();
    const link = draw({ role: 'link', href: '/office/fixture-office', onPress });
    expect(link.tagName).toBe('A');
    // The router follows an in-app path itself and keeps the browser from loading it.
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    pressKey(link, ' ');
    expect(onPress).not.toHaveBeenCalled();
    pressKey(link, 'Enter');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Enter and Space press every other role, once each', () => {
    for (const role of ['checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option'] as const) {
      const onPress = vi.fn();
      const element = draw({ role, onPress });
      // Not a native control: no browser clicks it for a key, so the page does.
      expect(element.tagName, role).toBe('DIV');
      pressKey(element, 'Enter');
      expect(onPress, role).toHaveBeenCalledTimes(1);
      pressKey(element, ' ');
      expect(onPress, role).toHaveBeenCalledTimes(2);
    }
  });

  it('Space is cancelled where the page presses, so the page does not scroll', () => {
    const checkbox = draw({ role: 'checkbox', onPress: vi.fn() });
    expect(fireEvent.keyDown(checkbox, { key: ' ' })).toBe(false);
    // A native button keeps its own behaviour: nothing is cancelled.
    const button = draw({ onPress: vi.fn() });
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true);
  });

  it('a held Space presses once, and no other key presses', () => {
    const onPress = vi.fn();
    const checkbox = draw({ role: 'checkbox', onPress });
    fireEvent.keyDown(checkbox, { key: ' ' });
    fireEvent.keyDown(checkbox, { key: ' ', repeat: true });
    fireEvent.keyDown(checkbox, { key: ' ', repeat: true });
    fireEvent.keyUp(checkbox, { key: ' ' });
    expect(onPress).toHaveBeenCalledTimes(1);
    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown']) {
      fireEvent.keyDown(checkbox, { key });
      fireEvent.keyUp(checkbox, { key });
    }
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Space does not press a disabled control of another role', () => {
    const onPress = vi.fn();
    const checkbox = draw({ role: 'checkbox', onPress, disabled: true });
    fireEvent.keyDown(checkbox, { key: ' ' });
    fireEvent.keyUp(checkbox, { key: ' ' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a key press plays the haptic once', () => {
    const onPress = vi.fn();
    const checkbox = draw({ role: 'checkbox', onPress, haptic: 'selection' });
    pressKey(checkbox, ' ');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
  });

  it('hitSlopFor brings a small drawing up to the 44-point target', () => {
    expect(hitSlopFor({ width: 36, height: 36 })).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
    expect(hitSlopFor({ width: 120, height: 32 })).toEqual({
      top: 6,
      bottom: 6,
      left: 0,
      right: 0,
    });
    expect(hitSlopFor({ width: 44, height: 44 })).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(hitSlopFor({ width: 80, height: 56 })).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(hitSlopFor(undefined)).toBeUndefined();
  });

  it('the drawn size reaches the press target as hit slop', () => {
    drawState('small');
    expect(nativeProps().hitSlop).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
    drawState('idle');
    expect(nativeProps().hitSlop).toBeUndefined();
  });

  it('a pressed fill paints pressedBg', () => {
    expect(drawState('fillPressed').style.backgroundColor).toBe(written('#E3E0D5'));
    expect(drawState('fillPressed', { theme: 'dark' }).style.backgroundColor).toBe(
      written('#2A2A26'),
    );
    // Without a press, and for a control that only moves, nothing is painted.
    expect(drawState('fill').style.backgroundColor).toBe('');
    const moving = drawState('pressed');
    expect(moving.style.backgroundColor).toBe('');
    expect(mover(moving)?.style.backgroundColor).toBe('');
    expect(draw({ feedback: 'none', preview: { pressed: true } }).style.backgroundColor).toBe('');
  });

  it('content that moves carries the fill, so the fill stays inside the outline', () => {
    const pressed = draw({ feedback: 'moveAndFill', preview: { pressed: true } });
    expect(mover(pressed)?.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(mover(pressed)?.style.borderRadius).toBe('4px');
    expect(mover(pressed)?.style.transform).toBe(MOVED);
    expect(pressed.style.backgroundColor).toBe('');

    for (const feedback of ['move', 'moveAndFill'] as const) {
      const hovered = draw({ feedback, hover: 'fill', preview: { hovered: true } });
      expect(mover(hovered)?.style.backgroundColor, feedback).toBe(written('#E3E0D5'));
      expect(hovered.style.backgroundColor, feedback).toBe('');
    }
    const dark = draw(
      { feedback: 'moveAndFill', radius: 0, preview: { pressed: true } },
      { theme: 'dark' },
    );
    expect(mover(dark)?.style.backgroundColor).toBe(written('#2A2A26'));
    expect(mover(dark)?.style.borderRadius).toBe('0px');
    // At rest the moving view paints nothing.
    expect(mover(draw({ feedback: 'moveAndFill', hover: 'fill' }))?.style.backgroundColor).toBe('');
  });

  it('a hover fill paints hoverBg under a pointer', () => {
    expect(drawState('fillHovered').style.backgroundColor).toBe(written('#E3E0D5'));
    expect(drawState('fillHovered', { theme: 'dark' }).style.backgroundColor).toBe(
      written('#2A2A26'),
    );
    // A real pointer does the same, and the fill goes when it leaves.
    const element = drawState('fill');
    movePointer(element, 'pointerenter');
    expect(element.style.backgroundColor).toBe(written('#E3E0D5'));
    movePointer(element, 'pointerleave');
    expect(element.style.backgroundColor).toBe('');
    // hover is 'none' unless asked.
    expect(drawState('hovered').style.backgroundColor).toBe('');
  });

  it('focus draws the ring outside the control, following its radius', () => {
    const forced = drawState('focused');
    expect(forced.style.outlineStyle).toBe('solid');
    expect(forced.style.outlineWidth).toBe('2px');
    expect(forced.style.outlineColor).toBe(written('#141412'));
    expect(forced.style.outlineOffset).toBe('2px');
    expect(forced.style.borderRadius).toBe('4px');
    expect(drawState('focused', { theme: 'dark' }).style.outlineColor).toBe(written('#F3F1EA'));

    // Real focus draws the same ring, and it goes with the focus.
    const element = drawState('idle');
    expect(element.style.outlineStyle).toBe('');
    act(() => {
      element.focus();
    });
    expect(element.style.outlineStyle).toBe('solid');
    expect(element.style.outlineWidth).toBe('2px');
    expect(element.style.outlineOffset).toBe('2px');
    act(() => {
      element.blur();
    });
    expect(element.style.outlineStyle).toBe('');
  });

  it('the radius is the corner of the box, the fills and the ring', () => {
    expect(draw().style.borderRadius).toBe('4px');
    const square = draw({ radius: 0, preview: { focused: true } });
    expect(square.style.borderRadius).toBe('0px');
    expect(square.style.outlineStyle).toBe('solid');
    expect(draw({ radius: 9999 }).style.borderRadius).toBe('9999px');
  });

  it('a pressed control moves its content, and a filled one does not', () => {
    expect(mover(drawState('pressed'))?.style.transform).toBe(MOVED);
    expect(
      mover(draw({ feedback: 'moveAndFill', preview: { pressed: true } }))?.style.transform,
    ).toBe(MOVED);
    expect(mover(drawState('idle'))?.style.transform).toBe('translateY(0px) scale(1)');
    // 'fill' and 'none' hold the content still: no moving view is drawn at all.
    expect(mover(drawState('fillPressed'))).toBeNull();
    expect(mover(draw({ feedback: 'none', preview: { pressed: true } }))).toBeNull();
  });

  it('under reduced motion a press does not move and tells the control to swap its fill', () => {
    const seen: { pressed: boolean; swapsFill: boolean }[] = [];
    const children: PressableProps['children'] = (state) => {
      seen.push({ pressed: state.pressed, swapsFill: state.swapsFill });
      return line;
    };
    const reduced = draw({ children, preview: { pressed: true } }, { reducedMotion: true });
    expect(mover(reduced)?.style.transform).toBe('translateY(0px) scale(1)');
    expect(seen.at(-1)).toEqual({ pressed: true, swapsFill: true });

    const moving = draw({ children, preview: { pressed: true } });
    expect(mover(moving)?.style.transform).toBe(MOVED);
    expect(seen.at(-1)).toEqual({ pressed: true, swapsFill: false });

    draw({ children }, { reducedMotion: true });
    expect(seen.at(-1)).toEqual({ pressed: false, swapsFill: false });
  });

  it('a real press moves the content and lets go of it', () => {
    const seen: boolean[] = [];
    const element = draw({
      role: 'checkbox',
      onPress: vi.fn(),
      children: (state) => {
        seen.push(state.pressed);
        return line;
      },
    });
    fireEvent.keyDown(element, { key: 'Enter' });
    expect(mover(element)?.style.transform).toBe(MOVED);
    expect(seen.at(-1)).toBe(true);
    fireEvent.keyUp(element, { key: 'Enter' });
    expect(mover(element)?.style.transform).toBe('translateY(0px) scale(1)');
    expect(seen.at(-1)).toBe(false);
  });

  it('the children function reads hover and focus, forced or real', () => {
    const seen: { hovered: boolean; focused: boolean }[] = [];
    const children: PressableProps['children'] = (state) => {
      seen.push({ hovered: state.hovered, focused: state.focused });
      return line;
    };
    draw({ children, preview: { hovered: true } });
    expect(seen.at(-1)).toEqual({ hovered: true, focused: false });
    draw({ children, preview: { focused: true } });
    expect(seen.at(-1)).toEqual({ hovered: false, focused: true });

    const element = draw({ children });
    expect(seen.at(-1)).toEqual({ hovered: false, focused: false });
    movePointer(element, 'pointerenter');
    expect(seen.at(-1)).toEqual({ hovered: true, focused: false });
    act(() => {
      element.focus();
    });
    expect(seen.at(-1)).toEqual({ hovered: true, focused: true });
    movePointer(element, 'pointerleave');
    act(() => {
      element.blur();
    });
    expect(seen.at(-1)).toEqual({ hovered: false, focused: false });
  });

  it('an in-app address renders an anchor in the same tab', () => {
    const link = drawState('link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/dev/gallery');
    expect(link.getAttribute('target')).toBeNull();
    expect(link.getAttribute('rel')).toBeNull();
    // Without an address there is no anchor.
    expect(drawState('idle').tagName).toBe('BUTTON');
    expect(drawState('idle').getAttribute('href')).toBeNull();
  });

  it('an outside link opens in a new tab and tells the other site nothing', () => {
    const link = draw({ role: 'link', href: 'https://www.example.test/a', external: true });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://www.example.test/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('a disabled link cannot be followed', () => {
    const onPress = vi.fn();
    const link = draw({ role: 'link', href: '/office/fixture-office', disabled: true, onPress });
    expect(link.tagName).not.toBe('A');
    expect(link.getAttribute('href')).toBeNull();
    expect(link.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(link);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a long press waits 500 ms and reaches the caller', () => {
    const onLongPress = vi.fn();
    draw({ onLongPress });
    expect(nativeProps().delayLongPress).toBe(500);
    expect(nativeProps().onLongPress).toBe(onLongPress);
    draw();
    expect(nativeProps().onLongPress).toBeUndefined();
  });

  it('the hint and the state reach screen readers', () => {
    const element = draw({
      role: 'tab',
      hint: 'Shows the filing steps',
      state: { selected: true, expanded: false, busy: true },
    });
    expect(nativeProps().accessibilityHint).toBe('Shows the filing steps');
    expect(element.getAttribute('aria-selected')).toBe('true');
    expect(element.getAttribute('aria-expanded')).toBe('false');
    expect(element.getAttribute('aria-busy')).toBe('true');
    expect(element.getAttribute('aria-checked')).toBeNull();

    expect(draw({ role: 'checkbox', state: { checked: true } }).getAttribute('aria-checked')).toBe(
      'true',
    );
    const plain = draw();
    for (const name of ['aria-selected', 'aria-checked', 'aria-expanded', 'aria-busy']) {
      expect(plain.getAttribute(name), name).toBeNull();
    }
  });

  it('an empty label leaves the name to the text inside', () => {
    const element = draw({ role: 'link', href: '/dev/gallery', label: '' });
    expect(element.hasAttribute('aria-label')).toBe(false);
    expect(screen.getByRole('link', { name: 'Open the office' })).toBe(element);
  });
});
