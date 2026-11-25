import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size } from '@/ui/tokens';

import { Checkbox } from './checkbox';
import type { CheckboxProps } from './checkbox';
import { GROUND, PREVIEW, STATES } from './checkbox.fixtures';
import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

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

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'unchecked',
  'checked',
  'positionEnd',
  'disabled',
  'disabledChecked',
  'withLink',
  'longLabel',
  'hovered',
  'pressed',
  'focused',
] as const;

const ALL: Readonly<Record<StateName, CheckboxProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.checkbox';
const LINK = 'gallery.checkbox-with-link-terms';
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];
const CHECK = 'M5 12.500 10 17.500 19 7';

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
  const element = <Checkbox {...ALL[state]} />;
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

/** Renders one checkbox under the probe id, unticked with a string label unless told otherwise. */
function draw(given: Partial<CheckboxProps> = {}): HTMLElement {
  cleanup();
  renderWithProviders(
    <Checkbox
      checked={false}
      onChange={() => undefined}
      label="Remind me before filing closes"
      labelText="Remind me before filing closes"
      testID={PROBE}
      {...given}
    />,
  );
  return screen.getByTestId(PROBE);
}

/** The box a checkbox draws: the one square of the checkbox size inside its press target. */
function boxOf(target: HTMLElement): HTMLElement {
  const side = `${String(size.checkbox)}px`;
  const box = [...target.querySelectorAll<HTMLElement>('*')].find(
    (part) => part.style.width === side && part.style.height === side,
  );
  if (box === undefined) {
    throw new Error('the checkbox draws no box');
  }
  return box;
}

/** The view that moves on press and carries the fills: the one with a transform. */
function mover(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>('[style*="transform"]');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Checkbox', () => {
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
          const box = boxOf(target);
          // The box: a square with the tag radius and a hairline, whatever the text size.
          expect(box.style.borderRadius, name).toBe('2px');
          expect(box.style.borderWidth, name).toBe('1px');
          const fill = off
            ? color[theme].disabledBg
            : fixture.checked
              ? color[theme].inverseBg
              : color[theme].surface;
          expect(box.style.backgroundColor, name).toBe(written(fill));
          // Only an unticked box that can be pressed has an outline of its own.
          expect(box.style.borderColor, name).toBe(
            written(off || fixture.checked ? fill : color[theme].rule),
          );
          // Ticked: the small check, in the inverse color, or the disabled one where it is off.
          const path = box.querySelector('path');
          if (fixture.checked) {
            expect(path?.getAttribute('d'), name).toBe(CHECK);
            expect(path?.getAttribute('stroke'), name).toBe(
              off ? color[theme].disabledText : color[theme].inverseText,
            );
            expect(box.querySelector('svg')?.getAttribute('width'), name).toBe('16');
          } else {
            expect(path, name).toBeNull();
          }
          expect(target.getAttribute('aria-checked'), name).toBe(String(fixture.checked));
          // The words: the body role at the text size in use.
          const words = screen.getByText(
            typeof fixture.label === 'string' ? fixture.label : 'I agree to the',
            { exact: false },
          );
          expect(words.style.fontSize, name).toBe(`${String(16 * scale)}px`);
          expect(words.style.color, name).toBe(
            written(off ? color[theme].disabledText : color[theme].text),
          );
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the ten states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.checkbox-${kebab(state)}`);
    }
    expect(STATES.positionEnd.position).toBe('end');
    expect(typeof STATES.withLink.label).toBe('object');
    expect(STATES.longLabel.label.length).toBeGreaterThan(100);
    // A consent is never ticked for the person.
    expect(STATES.withLink.checked).toBe(false);
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
      const fixture = ALL[state];
      expect(screen.getByRole('checkbox', { name: fixture.labelText }), state).toBe(target);
      expect(target.getAttribute('aria-label'), state).toBe(fixture.labelText);
      expect(screen.getAllByRole('checkbox'), state).toHaveLength(1);
      // The tick is decoration: the checked state says it.
      for (const icon of target.querySelectorAll('svg')) {
        expect(icon.closest('[aria-hidden="true"]'), state).not.toBeNull();
      }
    }
    // The link in a label keeps its own role and its name from the catalog.
    drawState('withLink');
    expect(screen.getByRole('link', { name: 'terms of use, opens in your browser' })).toBe(
      screen.getByTestId(LINK),
    );
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const target = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(target.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // Everything a person can press carries an id.
      for (const element of document.querySelectorAll('[role="checkbox"], a, button')) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
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
    // The same press moves the row where motion is allowed; the tick itself never moves.
    const moving = drawState('pressed');
    expect(mover(moving)?.style.transform).toBe(MOVED);
    expect(boxOf(moving).style.transform).toBe('');
  });

  it('the row is the target, at least as high as the smallest target', () => {
    for (const state of ['unchecked', 'positionEnd', 'longLabel'] as const) {
      const target = drawState(state);
      const row = boxOf(target).parentElement;
      expect(row?.style.minHeight, state).toBe(`${String(size.target)}px`);
      expect(row?.style.paddingTop, state).toBe('8px');
      expect(row?.style.paddingBottom, state).toBe('8px');
      expect(row?.style.columnGap, state).toBe('12px');
      // The words are inside the target: a press on them toggles the box.
      expect(target.textContent, state).toBe(ALL[state].label);
    }
    // The box comes first, and last where it stands at the row's end.
    const start = boxOf(drawState('unchecked'));
    expect(start.previousElementSibling).toBeNull();
    expect(start.nextElementSibling?.textContent).toBe(STATES.unchecked.label);
    const end = boxOf(drawState('positionEnd'));
    expect(end.nextElementSibling).toBeNull();
    expect(end.previousElementSibling?.textContent).toBe(STATES.positionEnd.label);
  });

  it('a pointer and a press fill the row, and focus rings it', () => {
    const hovered = drawState('hovered');
    expect(mover(hovered)?.style.backgroundColor).toBe(written(color.light.hoverBg));
    const pressed = drawState('pressed');
    expect(mover(pressed)?.style.backgroundColor).toBe(written(color.light.pressedBg));
    expect(drawState('focused').style.outlineStyle).toBe('solid');
    const resting = drawState('unchecked');
    expect(mover(resting)?.style.backgroundColor).toBe('');
    expect(resting.style.outlineStyle).toBe('');
  });

  it('toggles', () => {
    const onChange = vi.fn();
    const target = draw({ onChange });
    expect(target.getAttribute('role')).toBe('checkbox');
    expect(target.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    // The caller holds the answer: the box is ticked once the caller says so.
    expect(target.getAttribute('aria-checked')).toBe('false');
    const ticked = draw({ onChange, checked: true });
    expect(ticked.getAttribute('aria-checked')).toBe('true');
    expect(boxOf(ticked).querySelector('path')?.getAttribute('d')).toBe(CHECK);
    fireEvent.click(ticked);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('Space and Enter toggle from the keyboard', () => {
    const onChange = vi.fn();
    const target = draw({ onChange });
    act(() => {
      target.focus();
    });
    // The page presses on Space itself and cancels the key, so the page does not scroll.
    expect(fireEvent.keyDown(target, { key: ' ' })).toBe(false);
    fireEvent.keyUp(target, { key: ' ' });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(target, { key: 'Enter' });
    fireEvent.keyUp(target, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('disabled ignores presses', () => {
    const onChange = vi.fn();
    for (const label of ['Remind me before filing closes', STATES.withLink.label]) {
      const target = draw({ onChange, label, disabled: true });
      fireEvent.click(target);
      fireEvent.keyDown(target, { key: ' ' });
      fireEvent.keyDown(target, { key: 'Enter' });
      fireEvent.keyUp(target, { key: 'Enter' });
      expect(onChange).not.toHaveBeenCalled();
      // Out of the Tab order, and said to be off.
      expect(target.getAttribute('tabindex')).toBe('-1');
      expect(target.getAttribute('aria-disabled')).toBe('true');
    }
    expect(hapticsFake.calls).toEqual([]);
    // An enabled box is one stop in the Tab order.
    expect(draw().getAttribute('tabindex')).toBe('0');
  });

  it('the selection haptic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    const target = draw();
    fireEvent.click(target);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
    vi.advanceTimersByTime(1000);
    fireEvent.click(target);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }, { method: 'selection' }]);
    // The same for a label that holds a link, and never for the link.
    vi.advanceTimersByTime(1000);
    fireEvent.click(drawState('withLink'));
    expect(hapticsFake.calls).toHaveLength(3);
    vi.advanceTimersByTime(1000);
    screen.getByTestId(LINK).addEventListener('click', (event) => {
      event.preventDefault();
    });
    fireEvent.click(screen.getByTestId(LINK));
    expect(hapticsFake.calls).toHaveLength(3);
  });

  it('the link is its own target', () => {
    const onChange = vi.fn();
    cleanup();
    renderWithProviders(<Checkbox {...STATES.withLink} onChange={onChange} />);
    const target = screen.getByTestId(STATES.withLink.testID);
    const link = screen.getByTestId(LINK);
    // An anchor to the document, opened outside the app.
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://example.test/terms');
    expect(link.getAttribute('target')).toBe('_blank');
    // The test page follows no link.
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    fireEvent.click(link);
    expect(onChange).not.toHaveBeenCalled();
    // Neither do the words beside the link toggle the box: the label is no part of the target.
    fireEvent.click(screen.getByText('I agree to the', { exact: false }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(boxOf(target));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(target);
    expect(onChange).toHaveBeenCalledTimes(2);

    // No press target inside another: the link is not in the checkbox, nor the checkbox in the link.
    expect(target.contains(link)).toBe(false);
    expect(link.contains(target)).toBe(false);
    const targets = [...document.querySelectorAll<HTMLElement>('[role="checkbox"], a')];
    expect(targets).toHaveLength(2);
    for (const each of targets) {
      expect(each.querySelector('[role="checkbox"], a, [tabindex]')).toBeNull();
    }
    // The label lies over the target and lets a press through everywhere but on what it holds.
    const label = link.closest<HTMLElement>('[style*="pointer-events"], [class*="pointerEvents"]');
    expect(label).not.toBeNull();
    expect(label?.contains(target)).toBe(false);
    // The box comes first in the Tab order, then the link: two stops.
    const stops = [...document.querySelectorAll<HTMLElement>('[tabindex="0"], a[href]')];
    expect(stops).toEqual([target, link]);
  });

  it('a label with a link keeps the row, with the box at its start or its end', () => {
    const start = drawState('withLink');
    const row = start.parentElement?.parentElement;
    expect(row?.style.minHeight).toBe(`${String(size.target)}px`);
    // The target lies under the whole row.
    const under = start.parentElement;
    expect(under?.style.position).toBe('absolute');
    for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
      expect(under?.style[edge], edge).toBe('0px');
    }
    // The words stand clear of the box by the box and the gap.
    const words = row?.lastElementChild;
    expect(words).toBeInstanceOf(HTMLElement);
    expect((words as HTMLElement).style.marginLeft).toBe('32px'); // an element, checked on the line above
    expect(boxOf(start).parentElement?.style.justifyContent).toBe('');

    cleanup();
    renderWithProviders(<Checkbox {...STATES.withLink} position="end" />);
    const end = screen.getByTestId(STATES.withLink.testID);
    expect(boxOf(end).parentElement?.style.justifyContent).toBe('flex-end');
    const endWords = end.parentElement?.parentElement?.lastElementChild;
    expect((endWords as HTMLElement).style.marginRight).toBe('32px'); // the label's own view
    expect((endWords as HTMLElement).style.marginLeft).toBe(''); // the label's own view
  });

  it('a disabled label with a link is drawn in the disabled color', () => {
    cleanup();
    renderWithProviders(
      <Checkbox
        {...STATES.withLink}
        label={<Text role="body">I agree to the terms of use</Text>}
        disabled={true}
      />,
    );
    expect(screen.getByText('I agree to the terms of use').style.color).toBe(
      written(color.light.disabledText),
    );
  });

  it('never ticked by itself', () => {
    for (const state of ['unchecked', 'withLink', 'longLabel', 'hovered', 'focused'] as const) {
      const target = drawState(state);
      expect(target.getAttribute('aria-checked'), state).toBe('false');
      expect(boxOf(target).querySelector('svg'), state).toBeNull();
    }
    // Drawing it again, and moving focus to it, ticks nothing and tells the caller nothing.
    const onChange = vi.fn();
    const target = draw({ onChange });
    act(() => {
      target.focus();
      target.blur();
    });
    expect(target.getAttribute('aria-checked')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });
});
