import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { IconButton } from './icon-button';
import type { IconButtonProps } from './icon-button';
import { GROUND, PREVIEW, STATES } from './icon-button.fixtures';
import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';

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

const STATE_NAMES = [
  'plain',
  'plainHover',
  'plainPressed',
  'plainFocus',
  'plainDisabled',
  'framed',
  'framedHover',
  'framedPressed',
  'framedFocus',
  'framedDisabled',
  'primary',
  'primaryHover',
  'primaryPressed',
  'primaryFocus',
  'primaryDisabled',
  'selected',
  'small',
  'withBadge',
  'badgeOverflow',
] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.icon-button';
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

const BOOKMARK = 'M7 4h10v16l-5-4-5 4z';

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

type Drawn = {
  /** The press target. */
  target: HTMLElement;
  /** The square the icon sits in. */
  square: HTMLElement;
  /** The icon's one path. */
  path: SVGPathElement;
  /** The box that keeps the press target to the drawing. */
  box: HTMLElement;
  /** The view that moves on press; it carries the hover and pressed fills. */
  mover: HTMLElement | null;
};

function parts(target: HTMLElement): Drawn {
  const square = target.querySelector<HTMLElement>('[style*="justify-content"]');
  const path = target.querySelector('path');
  const box = target.parentElement;
  if (square === null || path === null || box === null) {
    throw new Error('the icon button is missing a part');
  }
  return { target, square, path, box, mover: target.querySelector('[style*="transform"]') };
}

function show(
  element: ReactElement,
  preview: InteractionPreviewState | undefined,
  options: RenderWithProvidersOptions,
): void {
  cleanup();
  pressables.props = [];
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
}

/** Renders one state of the fixtures, inside its preview when it has one. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): Drawn {
  show(<IconButton {...STATES[state]} />, preview, options);
  return parts(screen.getByTestId(STATES[state].testID));
}

type ProbeProps = Partial<IconButtonProps> & { preview?: InteractionPreviewState };

/** Renders one C-IconButton under the probe id, a plain bookmark unless told otherwise. */
function draw(given: ProbeProps = {}, options: RenderWithProvidersOptions = {}): Drawn {
  const { preview, ...props } = given;
  show(<IconButton icon="bookmark" label="Bookmark" testID={PROBE} {...props} />, preview, options);
  return parts(screen.getByTestId(PROBE));
}

/** The clear box that reaches past a small drawing to the full target; null when there is none. */
function reachOf(target: HTMLElement): HTMLElement | null {
  const first = target.firstElementChild;
  return first instanceof HTMLElement && first.style.position === 'absolute' ? first : null;
}

/** The props C-Pressable gave the native Pressable. */
function nativeProps(): Record<string, unknown> {
  const found = pressables.props.at(-1);
  if (found === undefined) {
    throw new Error('no native Pressable was rendered');
  }
  return found;
}

describe('IconButton', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        expect(drawState(state, { theme }).path.getAttribute('d'), state).toMatch(/^M/);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the nineteen states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    const interactions = {
      Hover: { hovered: true },
      Pressed: { pressed: true },
      Focus: { focused: true },
    };
    const expected: Record<string, InteractionPreviewState> = {};
    for (const variant of ['plain', 'framed', 'primary'] as const) {
      for (const [suffix, preview] of Object.entries(interactions)) {
        expected[`${variant}${suffix}`] = preview;
      }
      expect(STATES[`${variant}Disabled`].disabled).toBe(true);
    }
    expect(PREVIEW).toEqual(expected);
    expect(GROUND).toEqual({});
    expect(STATES.selected).toMatchObject({ icon: 'bookmark', selectedIcon: 'bookmarkFilled' });
    expect(STATES.withBadge).toMatchObject({ icon: 'messages', badge: 3 });
    expect(STATES.badgeOverflow.badge).toBe(120);
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const { target } = drawState(state);
      // The label is the whole name: the icon inside adds nothing to it.
      expect(screen.getByRole('button', { name: STATES[state].label }), state).toBe(target);
      expect(target.getAttribute('aria-label'), state).toBe(STATES[state].label);
      expect(target.querySelectorAll('[role], [aria-label]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const { target } = drawState(state);
      expect(target.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(target.getAttribute('data-testid'), state).toBe(`gallery.icon-button-${kebab(state)}`);
    }
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      const { target } = drawState(state, { reducedMotion: true }, { pressed: true });
      for (const part of [target, ...target.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
      }
    }
    // The same press moves the icon where motion is allowed.
    const moving = drawState('plain', {}, { pressed: true }).target;
    expect(moving.querySelector<HTMLElement>('[style*="transform"]')?.style.transform).toBe(MOVED);
  });

  it('a press reaches the caller once, with its haptic', () => {
    const onPress = vi.fn();
    fireEvent.click(draw({ onPress, haptic: 'selection' }).target);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
  });

  it('disabled takes no press, and draws its icon in disabledText', () => {
    const onPress = vi.fn();
    for (const variant of ['plain', 'framed', 'primary'] as const) {
      const { target, path } = draw({ variant, onPress, disabled: true });
      fireEvent.click(target);
      expect(target.getAttribute('aria-disabled'), variant).toBe('true');
      expect(target.getAttribute('tabindex'), variant).toBe('-1');
      expect(path.getAttribute('stroke'), variant).toBe('#535148');
    }
    expect(onPress).not.toHaveBeenCalled();
    expect(drawState('plainDisabled', { theme: 'dark' }).path.getAttribute('stroke')).toBe(
      '#A9A69B',
    );
  });

  it('a toggle swaps its icon, keeps its color and says it is selected', () => {
    const off = draw({ selectedIcon: 'bookmarkFilled', selected: false });
    expect(off.path.getAttribute('d')).toBe(BOOKMARK);
    expect(off.path.getAttribute('fill')).toBe('none');
    expect(off.path.getAttribute('stroke')).toBe('#141412');
    expect(off.target.getAttribute('aria-pressed')).toBe('false');
    expect(off.target.hasAttribute('aria-selected')).toBe(false);

    const on = drawState('selected');
    // The filled form is the same shape, filled, in the same color.
    expect(on.path.getAttribute('d')).toBe(BOOKMARK);
    expect(on.path.getAttribute('fill')).toBe('#141412');
    expect(on.path.getAttribute('stroke')).toBe('#141412');
    // A toggle button is pressed: a button may not carry aria-selected.
    expect(on.target.getAttribute('aria-pressed')).toBe('true');
    expect(on.target.hasAttribute('aria-selected')).toBe(false);
    expect(on.square.style.backgroundColor).toBe('');
    expect(on.target.style.backgroundColor).toBe('');

    // Without a second icon the button is no toggle: it keeps its icon and reports no state.
    const plain = draw({ selected: true });
    expect(plain.path.getAttribute('fill')).toBe('none');
    expect(plain.target.hasAttribute('aria-pressed')).toBe(false);
    expect(plain.target.hasAttribute('aria-selected')).toBe(false);
  });

  it('plain has no outline and no fill, and takes hoverBg under a pointer', () => {
    const { target, square, path } = drawState('plain');
    expect(square.style.borderWidth).toBe('');
    expect(square.style.backgroundColor).toBe('');
    expect(target.style.backgroundColor).toBe('');
    expect(path.getAttribute('stroke')).toBe('#141412');
    const hovered = drawState('plainHover');
    expect(hovered.mover?.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(hovered.mover?.style.borderRadius).toBe('4px');
    expect(hovered.target.style.backgroundColor).toBe('');
    expect(drawState('plainHover', { theme: 'dark' }).mover?.style.backgroundColor).toBe(
      written('#2A2A26'),
    );
    // A press moves it and paints nothing.
    const pressed = drawState('plainPressed');
    expect(pressed.target.style.backgroundColor).toBe('');
    expect(pressed.mover?.style.backgroundColor).toBe('');
    expect(pressed.square.style.backgroundColor).toBe('');
  });

  it('framed is a hairline of rule at the control radius, filled under a pointer and a press', () => {
    const { target, square } = drawState('framed');
    expect(square.style.borderWidth).toBe('1px');
    expect(square.style.borderColor).toBe(written('#141412'));
    expect(square.style.borderRadius).toBe('4px');
    expect(square.style.backgroundColor).toBe('');
    expect(target.style.backgroundColor).toBe('');
    expect(target.style.borderRadius).toBe('4px');
    expect(drawState('framed', { theme: 'dark' }).square.style.borderColor).toBe(
      written('#A9A69B'),
    );
    // The fill moves with the outline, and stays inside it.
    expect(drawState('framedHover').mover?.style.backgroundColor).toBe(written('#E3E0D5'));
    const pressed = drawState('framedPressed');
    expect(pressed.mover?.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(pressed.mover?.style.transform).toBe(MOVED);
    expect(pressed.mover?.contains(pressed.square)).toBe(true);
    expect(pressed.target.style.backgroundColor).toBe('');
  });

  it('a disabled framed button drops its outline and fills with disabledBg', () => {
    const { square, path, target, mover } = drawState('framedDisabled');
    expect(square.style.borderWidth).toBe('');
    expect(square.style.borderColor).toBe('');
    expect(square.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(square.style.borderRadius).toBe('4px');
    expect(path.getAttribute('stroke')).toBe('#535148');
    // The fill is the button's own: nothing else is painted, and the button keeps its size.
    expect(target.style.backgroundColor).toBe('');
    expect(mover?.style.backgroundColor).toBe('');
    expect(square.style.width).toBe('44px');
    expect(square.style.height).toBe('44px');

    const dark = drawState('framedDisabled', { theme: 'dark' });
    expect(dark.square.style.borderWidth).toBe('');
    expect(dark.square.style.backgroundColor).toBe(written('#2A2A26'));
    expect(dark.path.getAttribute('stroke')).toBe('#A9A69B');

    // A plain button has no outline to drop and gains no fill: its icon alone turns.
    const plain = drawState('plainDisabled');
    expect(plain.square.style.borderWidth).toBe('');
    expect(plain.square.style.backgroundColor).toBe('');
  });

  it('primary is the ink fill with an inverse icon', () => {
    const { square, path, target } = drawState('primary');
    expect(square.style.backgroundColor).toBe(written('#141412'));
    expect(square.style.borderRadius).toBe('4px');
    expect(square.style.borderWidth).toBe('');
    expect(path.getAttribute('stroke')).toBe('#F3F1EA');
    expect(target.style.backgroundColor).toBe('');
    const dark = drawState('primary', { theme: 'dark' });
    expect(dark.square.style.backgroundColor).toBe(written('#F3F1EA'));
    expect(dark.path.getAttribute('stroke')).toBe('#141412');

    expect(drawState('primaryHover').square.style.backgroundColor).toBe(written('#2A2A26'));
    expect(drawState('primaryHover', { theme: 'dark' }).square.style.backgroundColor).toBe(
      written('#E3E0D5'),
    );
    // A press moves it and keeps the fill.
    expect(drawState('primaryPressed').square.style.backgroundColor).toBe(written('#141412'));
    const disabled = drawState('primaryDisabled');
    expect(disabled.square.style.backgroundColor).toBe(written('#E3E0D5'));
    expect(disabled.path.getAttribute('stroke')).toBe('#535148');
  });

  it('under reduced motion a press swaps the fill instead of moving', () => {
    const reduced = { reducedMotion: true };
    expect(drawState('primaryPressed', reduced).square.style.backgroundColor).toBe(
      written('#2A2A26'),
    );
    expect(drawState('plainPressed', reduced).square.style.backgroundColor).toBe(
      written('#E3E0D5'),
    );
    expect(drawState('framedPressed', reduced).mover?.style.backgroundColor).toBe(
      written('#E3E0D5'),
    );
  });

  it('focus draws the ring round the drawing', () => {
    for (const state of ['plainFocus', 'framedFocus', 'primaryFocus'] as const) {
      const { target } = drawState(state);
      expect(target.style.outlineStyle, state).toBe('solid');
      expect(target.style.outlineWidth, state).toBe('2px');
      expect(target.style.outlineOffset, state).toBe('2px');
      expect(target.style.outlineColor, state).toBe(written('#141412'));
      expect(target.style.borderRadius, state).toBe('4px');
    }
  });

  it('the standard size is a 44-point target round a 24-point icon', () => {
    const { square, box, target } = drawState('plain');
    expect(square.style.width).toBe('44px');
    expect(square.style.height).toBe('44px');
    expect(box.style.width).toBe('44px');
    expect(box.style.height).toBe('44px');
    expect(target.querySelector('svg')?.getAttribute('width')).toBe('24');
    expect(nativeProps().hitSlop).toBeUndefined();
    // The drawing is the whole target: nothing reaches past it.
    expect(reachOf(target)).toBeNull();
  });

  it('small is 36 points round a 20-point icon, with hit slop 4', () => {
    const { square, box, target } = drawState('small');
    expect(square.style.width).toBe('36px');
    expect(square.style.height).toBe('36px');
    expect(box.style.width).toBe('36px');
    expect(box.style.height).toBe('36px');
    expect(target.querySelector('svg')?.getAttribute('width')).toBe('20');
    expect(nativeProps().hitSlop).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
  });

  it('a small button is pressed 4 points past its drawing on the page as well', () => {
    const onPress = vi.fn();
    const { target, box } = draw({ size: 'sm', onPress });
    const reach = reachOf(target);
    // 4 points on every side of the 36-point drawing: the 44-point target.
    expect(reach?.style.top).toBe('-4px');
    expect(reach?.style.bottom).toBe('-4px');
    expect(reach?.style.left).toBe('-4px');
    expect(reach?.style.right).toBe('-4px');
    // Nothing clips it: neither the press target nor the box that holds it to the drawing.
    expect(target.style.overflow).toBe('');
    expect(box.style.overflow).toBe('');
    fireEvent.click(reach ?? document.body);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a badge shows the count on the corner, hidden from screen readers', () => {
    const { target, square } = drawState('withBadge');
    const badge = target.querySelector<HTMLElement>(
      '[aria-hidden="true"][style*="flex-direction"]',
    );
    expect(badge?.textContent).toBe('3');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    // The name carries the count; the badge adds nothing to it.
    expect(screen.getByRole('button', { name: 'Messages, 3 unread' })).toBe(target);
    const corner = badge?.parentElement;
    expect(corner?.parentElement).toBe(square);
    expect(corner?.style.position).toBe('absolute');
    // One figure stands where the icon's corner is: 4 points down, its left edge 20 from the
    // button's right edge.
    expect(corner?.style.top).toBe('4px');
    expect(corner?.style.right).toBe('0px');
    expect(corner?.style.minWidth).toBe('20px');
    expect(corner?.style.justifyContent).toBe('flex-start');
  });

  it('the overflow badge rests on the icon and does not cover it', () => {
    const { target, square } = drawState('badgeOverflow');
    const badge = target.querySelector<HTMLElement>(
      '[aria-hidden="true"][style*="flex-direction"]',
    );
    expect(badge?.textContent).toBe('99+');
    const corner = badge?.parentElement;
    expect(corner?.parentElement).toBe(square);
    // Raised to the button's top edge: the badge is 16 high and the envelope starts below that.
    expect(corner?.style.top).toBe('0px');
    // Held at the button's right edge, so its width grows away from the screen's edge and it is
    // never anchored 4 points in, where it reached across the whole icon.
    expect(corner?.style.right).toBe('0px');
    expect(corner?.style.left).toBe('');
    // A count the badge writes out keeps the lower place, whatever its width.
    for (const count of [1, 9, 10, 99]) {
      const drawn = draw({ icon: 'messages', badge: count }).square;
      const at = drawn.querySelector<HTMLElement>('[style*="position: absolute"]');
      expect(at?.style.top, String(count)).toBe('4px');
      expect(at?.style.right, String(count)).toBe('0px');
    }
    expect(
      draw({ icon: 'messages', badge: 100 }).square.querySelector<HTMLElement>(
        '[style*="position: absolute"]',
      )?.style.top,
    ).toBe('0px');
  });

  it('a small button carries its badge on the very corner, and a count of zero draws none', () => {
    const small = draw({ size: 'sm', icon: 'messages', badge: 3 }).square;
    const corner = small.querySelector<HTMLElement>('[style*="position: absolute"]');
    expect(corner?.textContent).toBe('3');
    expect(corner?.style.top).toBe('0px');
    expect(corner?.style.right).toBe('0px');
    expect(corner?.style.minWidth).toBe('16px');
    expect(draw({ icon: 'messages', badge: 0 }).target.textContent).toBe('');
    expect(
      draw({ icon: 'messages' }).target.querySelector('[style*="position: absolute"]'),
    ).toBeNull();
  });

  it('with an address it is a link', () => {
    const { target } = draw({ href: '/dev/gallery', label: 'Open the gallery' });
    expect(target.tagName).toBe('A');
    expect(target.getAttribute('href')).toBe('/dev/gallery');
    expect(screen.getByRole('link', { name: 'Open the gallery' })).toBe(target);
  });

  it('names itself in a tooltip on focus', async () => {
    const { target } = draw({ label: 'Bookmark' });
    // At rest the name is a label alone: no words are drawn.
    expect(screen.queryByText('Bookmark')).toBeNull();
    fireEvent.focus(target);
    // The page says where the button is on the next turn.
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    const words = screen.getByText('Bookmark');
    expect(words.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(target.contains(words)).toBe(false);
    // The button keeps its one name, said once.
    expect(screen.getAllByRole('button', { name: 'Bookmark' })).toEqual([target]);
    fireEvent.blur(target);
    expect(screen.queryByText('Bookmark')).toBeNull();
  });
});
