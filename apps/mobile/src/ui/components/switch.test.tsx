import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, opacity, size } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { Switch } from './switch';
import type { SwitchProps } from './switch';
import { GROUND, PREVIEW, STATES } from './switch.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'off',
  'on',
  'withHelper',
  'disabled',
  'busy',
  'longLabel',
  'hovered',
  'pressed',
  'focused',
] as const;

const ALL: Readonly<Record<StateName, SwitchProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.switch';
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
  const element = <Switch {...ALL[state]} />;
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

/** Renders one switch under the probe id, off unless told otherwise. */
function draw(
  given: Partial<SwitchProps> = {},
  options: RenderWithProvidersOptions = {},
): HTMLElement {
  cleanup();
  renderWithProviders(
    <Switch
      value={false}
      onChange={() => undefined}
      label="Fits around a job"
      testID={PROBE}
      {...given}
    />,
    options,
  );
  return screen.getByTestId(PROBE);
}

/** The track a switch draws: the one box of the track's size inside its press target. */
function trackOf(target: HTMLElement): HTMLElement {
  const track = [...target.querySelectorAll<HTMLElement>('*')].find(
    (part) =>
      part.style.width === `${String(size.switchTrack.width)}px` &&
      part.style.height === `${String(size.switchTrack.height)}px`,
  );
  if (track === undefined) {
    throw new Error('the switch draws no track');
  }
  return track;
}

/** The thumb: the one thing the track holds. */
function thumbOf(target: HTMLElement): HTMLElement {
  const thumb = trackOf(target).firstElementChild;
  if (!(thumb instanceof HTMLElement)) {
    throw new Error('the track holds no thumb');
  }
  return thumb;
}

/** The view that moves on press and carries the fills: the one with a transform. */
function mover(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>('[style*="transform"]');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Switch', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const target = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          const off = fixture.disabled === true;
          // The track: 44 by 24 with the control radius, whatever the text size.
          const track = trackOf(target);
          expect(track.style.borderRadius, name).toBe('4px');
          expect(track.style.borderWidth, name).toBe('1px');
          const fill = off
            ? color[theme].disabledBg
            : fixture.value
              ? color[theme].inverseBg
              : color[theme].surface;
          expect(track.style.backgroundColor, name).toBe(written(fill));
          // Only an off track that can be pressed has an outline of its own.
          expect(track.style.borderColor, name).toBe(
            written(off || fixture.value ? fill : color[theme].rule),
          );
          // The thumb: a square with the tag radius, 4 from the track's outer edge on its side.
          const thumb = thumbOf(target);
          expect(thumb.style.width, name).toBe(`${String(size.switchThumb)}px`);
          expect(thumb.style.height, name).toBe(`${String(size.switchThumb)}px`);
          expect(thumb.style.borderRadius, name).toBe('2px');
          expect(thumb.style.top, name).toBe('3px');
          expect(thumb.style.left, name).toBe(fixture.value ? '' : '3px');
          expect(thumb.style.right, name).toBe(fixture.value ? '3px' : '');
          expect(thumb.style.backgroundColor, name).toBe(
            written(
              off
                ? color[theme].disabledText
                : fixture.value
                  ? color[theme].inverseText
                  : color[theme].text,
            ),
          );
          expect(target.getAttribute('aria-checked'), name).toBe(String(fixture.value));
          const label = screen.getByText(fixture.label);
          expect(label.style.fontSize, name).toBe(`${String(16 * scale)}px`);
          expect(label.style.color, name).toBe(
            written(off ? color[theme].disabledText : color[theme].text),
          );
          if (fixture.helper !== undefined) {
            const helper = screen.getByText(fixture.helper);
            expect(Number.parseFloat(helper.style.fontSize), name).toBeCloseTo(13 * scale);
            expect(helper.style.color, name).toBe(written(color[theme].textSecondary));
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the nine states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.switch-${kebab(state)}`);
    }
    expect(STATES.busy.busy).toBe(true);
    expect(STATES.disabled.disabled).toBe(true);
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
      // The label is the name; on or off is the checked state, never a word of its own.
      expect(screen.getByRole('switch', { name: ALL[state].label }), state).toBe(target);
      expect(target.getAttribute('aria-label'), state).toBe(ALL[state].label);
      expect(target.getAttribute('aria-selected'), state).toBeNull();
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const target = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(target.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      expect(document.querySelectorAll('[role="switch"]'), state).toHaveLength(1);
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
    // The label of a waiting switch is held at the pulse's low point, so the wait still shows.
    const waiting = screen.getByText(
      (drawState('busy', { reducedMotion: true }), STATES.busy.label),
    );
    expect(waiting.parentElement?.style.opacity).toBe(String(opacity.skeletonLow));
    // Where motion is allowed the same label is on the pulse, which starts at full strength.
    drawState('busy');
    expect(screen.getByText(STATES.busy.label).parentElement?.style.opacity).toBe('1');
    // A switch that is not waiting has no pulse to hold.
    drawState('on', { reducedMotion: true });
    expect(screen.getByText(STATES.on.label).parentElement?.style.opacity).toBe('');
    // The same press moves the row where motion is allowed.
    expect(mover(drawState('pressed'))?.style.transform).toBe(MOVED);
  });

  it('the row is the target, with the words at the left and the switch at the right', () => {
    for (const state of ['off', 'withHelper', 'longLabel'] as const) {
      const target = drawState(state);
      const track = trackOf(target);
      const row = track.parentElement;
      expect(row?.style.minHeight, state).toBe(`${String(size.target)}px`);
      expect(row?.style.columnGap, state).toBe('12px');
      expect(row?.style.alignItems, state).toBe('center');
      expect(track.nextElementSibling, state).toBeNull();
      const words = track.previousElementSibling;
      expect(words?.textContent, state).toBe(`${ALL[state].label}${ALL[state].helper ?? ''}`);
      expect(words instanceof HTMLElement ? words.style.flexGrow : '', state).toBe('1');
    }
  });

  it('a pointer and a press fill the row, and focus rings it', () => {
    expect(mover(drawState('hovered'))?.style.backgroundColor).toBe(written(color.light.hoverBg));
    expect(mover(drawState('pressed'))?.style.backgroundColor).toBe(written(color.light.pressedBg));
    expect(drawState('focused').style.outlineStyle).toBe('solid');
    const resting = drawState('off');
    expect(mover(resting)?.style.backgroundColor).toBe('');
    expect(resting.style.outlineStyle).toBe('');
  });

  it('toggles', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    const onChange = vi.fn();
    const target = draw({ onChange });
    expect(target.getAttribute('role')).toBe('switch');
    expect(target.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
    // The caller holds the setting: the switch is on once the caller says so.
    expect(target.getAttribute('aria-checked')).toBe('false');
    const on = draw({ onChange, value: true });
    expect(on.getAttribute('aria-checked')).toBe('true');
    vi.advanceTimersByTime(1000);
    fireEvent.click(on);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }, { method: 'selection' }]);
  });

  it('Space and Enter flip it from the keyboard', () => {
    const onChange = vi.fn();
    const target = draw({ onChange });
    act(() => {
      target.focus();
    });
    expect(fireEvent.keyDown(target, { key: ' ' })).toBe(false);
    fireEvent.keyUp(target, { key: ' ' });
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyUp(target, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('busy', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    const onChange = vi.fn();
    const target = draw({ onChange, value: true, busy: true });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: ' ' });
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyUp(target, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
    expect(target.getAttribute('aria-busy')).toBe('true');
    // It is waiting, not off: it keeps its place in the Tab order, its fill and its state.
    expect(target.getAttribute('aria-disabled')).toBeNull();
    expect(target.getAttribute('tabindex')).toBe('0');
    expect(target.getAttribute('aria-checked')).toBe('true');
    expect(trackOf(target).style.backgroundColor).toBe(written(color.light.inverseBg));
    // A switch that is not waiting says so.
    expect(draw().getAttribute('aria-busy')).toBe('false');
  });

  it('disabled ignores presses and leaves the Tab order', () => {
    const onChange = vi.fn();
    const target = draw({ onChange, disabled: true });
    fireEvent.click(target);
    fireEvent.keyDown(target, { key: ' ' });
    expect(onChange).not.toHaveBeenCalled();
    expect(hapticsFake.calls).toEqual([]);
    expect(target.getAttribute('aria-disabled')).toBe('true');
    expect(target.getAttribute('tabindex')).toBe('-1');
  });

  it('cut, not tween', () => {
    const { rerender } =
      (cleanup(),
      renderWithProviders(
        <Switch
          value={false}
          onChange={() => undefined}
          label="Fits around a job"
          testID={PROBE}
        />,
      ));
    const before = thumbOf(screen.getByTestId(PROBE));
    expect(before.style.left).toBe('3px');
    expect(before.style.right).toBe('');
    rerender(
      <Switch value={true} onChange={() => undefined} label="Fits around a job" testID={PROBE} />,
    );
    // One render later the thumb stands at the other end and the track is ink: nothing is between.
    const target = screen.getByTestId(PROBE);
    const thumb = thumbOf(target);
    expect(thumb).toBe(before);
    expect(thumb.style.left).toBe('');
    expect(thumb.style.right).toBe('3px');
    expect(thumb.style.backgroundColor).toBe(written(color.light.inverseText));
    expect(trackOf(target).style.backgroundColor).toBe(written(color.light.inverseBg));
    // Neither the thumb nor the track carries a transition, an animation or a transform to tween.
    for (const part of [thumb, trackOf(target)]) {
      const style = part.getAttribute('style') ?? '';
      expect(style).not.toMatch(/transition|animation|transform/);
      expect(part.style.opacity).toBe('');
    }
  });
});
