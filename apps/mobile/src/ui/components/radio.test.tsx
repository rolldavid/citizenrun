import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { ViewInstance } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { Radio } from './radio';
import type { RadioProps } from './radio';
import { GROUND, PREVIEW, STATES } from './radio.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'unselected',
  'selected',
  'withHelper',
  'longLabel',
  'hovered',
  'pressed',
  'focused',
] as const;

const ALL: Readonly<Record<StateName, RadioProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.radio';
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one state of the fixtures, inside its preview when it has one. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): HTMLElement {
  cleanup();
  const element = <Radio {...ALL[state]} />;
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
  return screen.getByTestId(ALL[state].testID);
}

/** Renders one radio under the probe id, not chosen unless told otherwise. */
function draw(given: Partial<RadioProps> = {}): HTMLElement {
  cleanup();
  renderWithProviders(
    <Radio
      selected={false}
      label="Everyone can message me"
      onSelect={() => undefined}
      testID={PROBE}
      {...given}
    />,
  );
  return screen.getByTestId(PROBE);
}

/** The circle a radio draws: the one round box of the radio size inside its press target. */
function circleOf(target: HTMLElement): HTMLElement {
  const side = `${String(size.radio)}px`;
  const circle = [...target.querySelectorAll<HTMLElement>('*')].find(
    (part) => part.style.width === side && part.style.height === side,
  );
  if (circle === undefined) {
    throw new Error('the radio draws no circle');
  }
  return circle;
}

/** The view that moves on press and carries the fills: the one with a transform. */
function mover(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>('[style*="transform"]');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Radio', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const target = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          // The circle: round, `surface` with a hairline of `rule`, chosen or not.
          const circle = circleOf(target);
          expect(circle.style.borderRadius, name).toBe('9999px');
          expect(circle.style.borderWidth, name).toBe('1px');
          expect(circle.style.backgroundColor, name).toBe(written(color[theme].surface));
          expect(circle.style.borderColor, name).toBe(written(color[theme].rule));
          // Chosen: the disc in the text color, at the circle's middle.
          const disc = circle.firstElementChild;
          if (fixture.selected) {
            expect(disc, name).toBeInstanceOf(HTMLElement);
            const drawn = disc as HTMLElement; // an element, checked on the line above
            expect(drawn.style.width, name).toBe(`${String(size.radioDot)}px`);
            expect(drawn.style.height, name).toBe(`${String(size.radioDot)}px`);
            expect(drawn.style.borderRadius, name).toBe('9999px');
            expect(drawn.style.backgroundColor, name).toBe(written(color[theme].text));
            expect(circle.style.alignItems, name).toBe('center');
            expect(circle.style.justifyContent, name).toBe('center');
          } else {
            expect(disc, name).toBeNull();
          }
          expect(target.getAttribute('aria-checked'), name).toBe(String(fixture.selected));
          // The label in the body role, and the helper under it in the caption role.
          const label = screen.getByText(fixture.label);
          expect(label.style.fontSize, name).toBe(`${String(16 * scale)}px`);
          expect(label.style.color, name).toBe(written(color[theme].text));
          if (fixture.helper !== undefined) {
            const helper = screen.getByText(fixture.helper);
            expect(Number.parseFloat(helper.style.fontSize), name).toBeCloseTo(13 * scale);
            expect(helper.style.color, name).toBe(written(color[theme].textSecondary));
            expect(label.nextElementSibling, name).toBe(helper);
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.radio-${kebab(state)}`);
    }
    expect(STATES.withHelper.helper).not.toBe('');
    expect(STATES.longLabel.label.length).toBeGreaterThan(80);
    expect(PREVIEW).toEqual({
      hovered: { hovered: true },
      pressed: { pressed: true },
      focused: { focused: true },
    });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const target = drawState(state);
      expect(screen.getByRole('radio', { name: ALL[state].label }), state).toBe(target);
      expect(target.getAttribute('aria-label'), state).toBe(ALL[state].label);
      // A radio is checked or not, and never said to be selected.
      expect(target.getAttribute('aria-selected'), state).toBeNull();
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const target = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(target.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      expect(document.querySelectorAll('[role="radio"]'), state).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      const target = drawState(state, { reducedMotion: true }, { pressed: true });
      for (const part of [target, ...target.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
        expect(part.style.transition, state).toBe('');
      }
    }
    // The same press moves the row where motion is allowed; the disc itself never moves.
    const moving = drawState('pressed');
    expect(mover(moving)?.style.transform).toBe(MOVED);
    expect(circleOf(moving).style.transform).toBe('');
  });

  it('the row is the target, at least as high as the smallest target', () => {
    for (const state of ['unselected', 'withHelper', 'longLabel'] as const) {
      const target = drawState(state);
      const circle = circleOf(target);
      const row = circle.parentElement;
      expect(row?.style.minHeight, state).toBe(`${String(size.target)}px`);
      expect(row?.style.columnGap, state).toBe('12px');
      expect(row?.style.alignItems, state).toBe('center');
      // The circle comes first; the words take the rest of the row and wrap in it.
      expect(circle.previousElementSibling, state).toBeNull();
      expect(circle.nextElementSibling?.textContent, state).toBe(
        `${ALL[state].label}${ALL[state].helper ?? ''}`,
      );
    }
  });

  it('a pointer and a press fill the row, and focus rings it', () => {
    expect(mover(drawState('hovered'))?.style.backgroundColor).toBe(written(color.light.hoverBg));
    expect(mover(drawState('pressed'))?.style.backgroundColor).toBe(written(color.light.pressedBg));
    expect(drawState('focused').style.outlineStyle).toBe('solid');
    const resting = drawState('unselected');
    expect(mover(resting)?.style.backgroundColor).toBe('');
    expect(resting.style.outlineStyle).toBe('');
  });

  it('a press chooses it, with the selection haptic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    const onSelect = vi.fn();
    const target = draw({ onSelect });
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith();
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
    // The caller holds the choice: the disc is drawn once the caller says so.
    expect(target.getAttribute('aria-checked')).toBe('false');
    expect(draw({ onSelect, selected: true }).getAttribute('aria-checked')).toBe('true');
  });

  it('Space and Enter choose it from the keyboard', () => {
    const onSelect = vi.fn();
    const target = draw({ onSelect });
    act(() => {
      target.focus();
    });
    expect(fireEvent.keyDown(target, { key: ' ' })).toBe(false);
    fireEvent.keyUp(target, { key: ' ' });
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyUp(target, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('its group can take it out of the Tab order and move focus to it', () => {
    const ref = createRef<ViewInstance>();
    const onSelect = vi.fn();
    const target = draw({ focusable: false, ref, onSelect });
    expect(target.getAttribute('tabindex')).toBe('-1');
    act(() => {
      ref.current?.focus();
    });
    expect(document.activeElement).toBe(target);
    // Out of the Tab order it is still pressed.
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledTimes(1);
    // By itself it is a stop in the Tab order.
    expect(draw().getAttribute('tabindex')).toBe('0');
  });

  it('the helper is the hint a phone reads after the label', () => {
    const target = drawState('withHelper');
    // The words of the helper are drawn inside the row, so a press on them chooses the option.
    expect(target.textContent).toBe(`${STATES.withHelper.label}${STATES.withHelper.helper}`);
    expect(drawState('unselected').textContent).toBe(STATES.unselected.label);
  });
});
