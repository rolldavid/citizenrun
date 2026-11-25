import { EMAIL_CODE_DIGITS } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, opacity, radius, rule, size, space } from '@/ui/tokens';

import { CodeField } from './code-field';
import type { CodeFieldProps } from './code-field';
import { GROUND, PREVIEW, STATES } from './code-field.fixtures';
import { InteractionPreview } from './pressable';

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
  'empty',
  'partial',
  'complete',
  'checking',
  'wrong',
  'locked',
  'focused',
] as const;

const ALL: Readonly<Record<StateName, CodeFieldProps>> = STATES;

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.code';
const HINT = 'Enter the 6-digit code';
const NO_BREAK_SPACE = '\u00A0';

afterEach(() => {
  vi.useRealTimers();
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one field, in place of whatever was drawn before, and gives back its input. */
function draw(props: CodeFieldProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  renderWithProviders(<CodeField {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** Renders a state of the fixtures as the gallery does, forced where the state is an interaction. */
function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  renderWithProviders(
    <InteractionPreview state={PREVIEW[state] ?? {}}>
      <CodeField {...ALL[state]} />
    </InteractionPreview>,
    options,
  );
  return screen.getByTestId(ALL[state].testID);
}

/** A field under the probe id: empty and waiting for its digits unless told otherwise. */
function probe(given: Partial<CodeFieldProps> = {}): CodeFieldProps {
  return {
    label: 'Code from your email',
    value: '',
    onChangeText: () => undefined,
    onComplete: () => undefined,
    status: 'idle',
    statusText: null,
    testID: PROBE,
    ...given,
  };
}

/** The boxes under an input, in order. */
function boxesOf(input: HTMLElement): HTMLElement[] {
  const row = input.parentElement?.firstElementChild;
  if (!(row instanceof HTMLElement)) {
    throw new Error('the field draws no boxes');
  }
  return [...row.children].filter((box): box is HTMLElement => box instanceof HTMLElement);
}

/** What each box shows. */
function digitsOf(input: HTMLElement): string[] {
  return boxesOf(input).map((box) => box.textContent);
}

/** The elements that describe an input, in the order it names them. */
function describersOf(input: HTMLElement): HTMLElement[] {
  return (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => {
      const element = document.querySelector<HTMLElement>(`[id="${id}"]`);
      if (element === null) {
        throw new Error(`nothing has the id ${id}`);
      }
      return element;
    });
}

/** The line under the boxes: the last of what describes the input. */
function lineOf(input: HTMLElement): HTMLElement {
  const line = describersOf(input).at(-1);
  if (line === undefined) {
    throw new Error('the field draws no line');
  }
  return line;
}

describe('CodeField', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const input = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          const boxes = boxesOf(input);
          expect(boxes, name).toHaveLength(EMAIL_CODE_DIGITS);
          expect(digitsOf(input).join(''), name).toBe(fixture.value);
          for (const box of boxes) {
            expect(box.style.width, name).toBe(`${String(size.codeBox.width)}px`);
            expect(box.style.height, name).toBe(`${String(size.codeBox.height)}px`);
            expect(box.style.borderRadius, name).toBe(`${String(radius.control)}px`);
            expect(box.style.backgroundColor, name).toBe(
              written(fixture.status === 'locked' ? color[theme].disabledBg : color[theme].surface),
            );
          }
          expect(boxes[0]?.parentElement?.style.gap, name).toBe(`${String(space.x2)}px`);
          expect(screen.getByText(fixture.label), name).toBeDefined();
          expect(lineOf(input), name).toBeDefined();
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the six states and the focused field', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.empty.value).toBe('');
    expect(STATES.partial.value).toHaveLength(3);
    expect(STATES.complete.value).toHaveLength(EMAIL_CODE_DIGITS);
    expect(STATE_NAMES.map((state) => ALL[state].status)).toEqual([
      'idle',
      'idle',
      'idle',
      'checking',
      'wrong',
      'locked',
      'idle',
    ]);
    expect(PREVIEW).toEqual({ focused: { focused: true } });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const input = drawState(state);
      expect(screen.getByRole('textbox', { name: ALL[state].label }), state).toBe(input);
      expect(input.getAttribute('aria-label'), state).toBe(ALL[state].label);
      const labelledBy = input.getAttribute('aria-labelledby');
      expect(document.querySelector(`[id="${labelledBy ?? ''}"]`)?.textContent, state).toBe(
        ALL[state].label,
      );
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const input = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(input.getAttribute('data-testid'), state).toBe(ALL[state].testID);
    }
  });

  it('respects reduced motion', () => {
    const low = String(opacity.skeletonLow);
    const strengths = (input: HTMLElement): (string | undefined)[] =>
      boxesOf(input).map(
        (box) => box.querySelector<HTMLElement>('[style*="opacity"]')?.style.opacity,
      );
    // With motion the digits pulse while the code is checked, from full strength.
    expect(strengths(drawState('checking'))).toEqual(Array(EMAIL_CODE_DIGITS).fill('1'));
    // Without it they are held at the low point of the pulse, and the boxes keep their fill.
    const held = drawState('checking', { reducedMotion: true });
    expect(strengths(held)).toEqual(Array(EMAIL_CODE_DIGITS).fill(low));
    for (const box of boxesOf(held)) {
      expect(box.style.opacity).toBe('');
    }
    // A field that waits for nothing holds nothing back, and nothing of any state moves.
    for (const reducedMotion of [false, true]) {
      for (const state of STATE_NAMES) {
        const input = drawState(state, { reducedMotion });
        for (const part of [...boxesOf(input), lineOf(input)]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
        if (state !== 'checking') {
          expect(strengths(input), state).toEqual(Array(EMAIL_CODE_DIGITS).fill('1'));
        }
      }
    }
  });

  it('paste fills the boxes', () => {
    const calls: string[] = [];
    const onChangeText = vi.fn((value: string) => {
      calls.push(`change ${value}`);
    });
    const onComplete = vi.fn((value: string) => {
      calls.push(`complete ${value}`);
    });
    const input = draw(probe({ onChangeText, onComplete }));
    fireEvent.change(input, { target: { value: '12 34 56' } });
    expect(onChangeText).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(calls).toEqual(['change 123456', 'complete 123456']);

    // The caller holds the digits, and the boxes show what the caller holds.
    const filled = draw(probe({ value: '123456' }));
    expect(digitsOf(filled)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('only digits', () => {
    const onChangeText = vi.fn();
    const onComplete = vi.fn();
    const input = draw(probe({ onChangeText, onComplete }));
    fireEvent.change(input, { target: { value: 'a1b2' } });
    expect(onChangeText).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenCalledWith('12');
    expect(onComplete).not.toHaveBeenCalled();
    // More digits than a code has are cut to the code's length.
    fireEvent.change(input, { target: { value: '1234567890' } });
    expect(onChangeText).toHaveBeenLastCalledWith('123456');
  });

  it('the code is complete once, when its last digit arrives', () => {
    const onChangeText = vi.fn();
    const onComplete = vi.fn();
    // Five digits and then the sixth.
    const input = draw(probe({ value: '12345', onChangeText, onComplete }));
    fireEvent.change(input, { target: { value: '123456' } });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');

    // A whole code changed into another whole code is not completed a second time.
    const whole = draw(probe({ value: '123456', onChangeText, onComplete }));
    fireEvent.change(whole, { target: { value: '654321' } });
    expect(onChangeText).toHaveBeenLastCalledWith('654321');
    expect(onComplete).toHaveBeenCalledTimes(1);
    // A digit taken away completes nothing.
    fireEvent.change(whole, { target: { value: '12345' } });
    expect(onChangeText).toHaveBeenLastCalledWith('12345');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('the input is set for a code the system can fill in', () => {
    const input = draw(probe());
    expect(input.tagName).toBe('INPUT');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    // A limit on the input would cut a pasted "12 34 56" before its change arrives: the change
    // keeps the digits instead.
    expect(input.hasAttribute('maxlength')).toBe(false);
    expect(input).toHaveProperty('readOnly', false);
    // It lies over the whole row, unseen, and still takes every tap and paste.
    expect(input.style.position).toBe('absolute');
    expect(input.style.width).toBe('100%');
    expect(input.style.height).toBe('100%');
    expect(input.style.opacity).toBe('0');
    expect(input.style.pointerEvents).toBe('');
    expect(input.style.outlineWidth).toBe('0px');
  });

  it('the box of the next digit carries the ring while the input is focused', () => {
    const rings = (input: HTMLElement): boolean[] =>
      boxesOf(input).map((box) => box.style.outlineStyle === 'solid');
    const none = Array<boolean>(EMAIL_CODE_DIGITS).fill(false);
    const at = (place: number): boolean[] => none.map((_, index) => index === place);

    const input = draw(probe({ value: '418' }));
    expect(rings(input)).toEqual(none);
    act(() => {
      input.focus();
    });
    expect(rings(input)).toEqual(at(3));
    const ringed = boxesOf(input)[3];
    expect(ringed?.style.outlineWidth).toBe(`${String(rule.focus)}px`);
    expect(ringed?.style.outlineColor).toBe(written(color.light.focusRing));
    act(() => {
      input.blur();
    });
    expect(rings(input)).toEqual(none);

    // The first box of an empty field, and the last box of a whole code.
    expect(rings(drawState('focused'))).toEqual(at(3));
    const empty = draw(probe());
    act(() => {
      empty.focus();
    });
    expect(rings(empty)).toEqual(at(0));
    const whole = draw(probe({ value: '418207' }));
    act(() => {
      whole.focus();
    });
    expect(rings(whole)).toEqual(at(EMAIL_CODE_DIGITS - 1));
  });

  it('idle keeps an empty line, and each box has a hairline of the rule color', () => {
    for (const theme of ['light', 'dark'] as const) {
      const input = drawState('partial', { theme });
      expect(lineOf(input).textContent).toBe(NO_BREAK_SPACE);
      expect(document.querySelector('[role="alert"]')).toBeNull();
      for (const box of boxesOf(input)) {
        expect(box.style.borderWidth).toBe(`${String(rule.hairline)}px`);
        expect(box.style.borderColor).toBe(written(color[theme].rule));
      }
      // The digits are numerals of the title size, tabular, in the text color.
      const digit = boxesOf(input)[0]?.querySelector<HTMLElement>('[dir]');
      expect(digit?.textContent).toBe('4');
      expect(digit?.style.fontSize).toBe('28px');
      expect(digit?.style.fontVariant).toContain('tabular-nums');
      expect(digit?.style.color).toBe(written(color[theme].text));
    }
  });

  it('wrong turns every border and shows the caller’s sentence as an alert', () => {
    for (const theme of ['light', 'dark'] as const) {
      const input = drawState('wrong', { theme });
      for (const box of boxesOf(input)) {
        expect(box.style.borderWidth).toBe(`${String(rule.fieldState)}px`);
        expect(box.style.borderColor).toBe(written(color[theme].danger));
        expect(box.style.backgroundColor).toBe(written(color[theme].surface));
      }
      const line = lineOf(input);
      expect(line.textContent).toBe(STATES.wrong.statusText);
      expect(line.getAttribute('role')).toBe('alert');
      expect(screen.getByText(STATES.wrong.statusText).style.color).toBe(
        written(color[theme].danger),
      );
      expect(line.querySelectorAll('svg')).toHaveLength(1);
      // A wrong code can be typed over.
      expect(input).toHaveProperty('readOnly', false);
    }
  });

  it('wrong plays the warning haptic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    cleanup();
    setViewport(...COMPACT);
    const view = renderWithProviders(<CodeField {...probe({ value: '418207' })} />);
    expect(hapticsFake.calls).toEqual([]);
    view.rerender(<CodeField {...probe({ value: '418207', status: 'checking' })} />);
    expect(hapticsFake.calls).toEqual([]);
    const wrong = probe({
      value: '418207',
      status: 'wrong',
      statusText: 'That code is not right.',
    });
    view.rerender(<CodeField {...wrong} />);
    expect(hapticsFake.calls).toEqual([{ method: 'notify', kind: 'warning' }]);

    // Once for each time the code turns out wrong: not again while it stays wrong.
    vi.advanceTimersByTime(1000);
    view.rerender(<CodeField {...wrong} value="41820" />);
    view.rerender(<CodeField {...wrong} statusText="Still not right." />);
    expect(hapticsFake.calls).toHaveLength(1);
    // And again after another try.
    view.rerender(<CodeField {...probe({ value: '418208', status: 'checking' })} />);
    vi.advanceTimersByTime(1000);
    view.rerender(<CodeField {...wrong} value="418208" />);
    expect(hapticsFake.calls).toEqual([
      { method: 'notify', kind: 'warning' },
      { method: 'notify', kind: 'warning' },
    ]);
  });

  it('a field first drawn wrong, and a locked field, play no haptic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    drawState('wrong');
    expect(hapticsFake.calls).toEqual([]);
    cleanup();
    const view = renderWithProviders(<CodeField {...probe({ value: '418207' })} />);
    view.rerender(
      <CodeField
        {...probe({ value: '418207', status: 'locked', statusText: 'Too many tries.' })}
      />,
    );
    expect(hapticsFake.calls).toEqual([]);
  });

  it('locked is not editable', () => {
    for (const theme of ['light', 'dark'] as const) {
      const input = drawState('locked', { theme });
      expect(input).toHaveProperty('readOnly', true);
      for (const box of boxesOf(input)) {
        expect(box.style.backgroundColor).toBe(written(color[theme].disabledBg));
        expect(box.style.borderWidth).toBe('');
        expect(box.querySelector<HTMLElement>('[dir]')?.style.color).toBe(
          written(color[theme].disabledText),
        );
      }
      // The line says when to try again, as an error.
      const line = lineOf(input);
      expect(line.textContent).toBe(STATES.locked.statusText);
      expect(line.getAttribute('role')).toBe('alert');
      // A locked field shows no ring.
      act(() => {
        input.focus();
      });
      expect(boxesOf(input).some((box) => box.style.outlineStyle === 'solid')).toBe(false);
    }
  });

  it('checking is not editable and keeps its boxes', () => {
    const input = drawState('checking');
    expect(input).toHaveProperty('readOnly', true);
    expect(lineOf(input).textContent).toBe(NO_BREAK_SPACE);
    for (const box of boxesOf(input)) {
      expect(box.style.borderWidth).toBe(`${String(rule.hairline)}px`);
      expect(box.style.backgroundColor).toBe(written(color.light.surface));
    }
  });

  it('one text field', () => {
    for (const state of STATE_NAMES) {
      const input = drawState(state);
      // One input for the whole code, and never one for each digit.
      expect(document.querySelectorAll('input, textarea'), state).toHaveLength(1);
      expect(screen.getAllByRole('textbox'), state).toEqual([input]);
      expect(screen.getByRole('textbox', { name: ALL[state].label }), state).toBe(input);
      // The hint describes it, with the line under the boxes.
      const [hint, line] = describersOf(input);
      expect(hint?.textContent, state).toBe(HINT);
      expect(hint?.style.display, state).toBe('none');
      expect(line, state).toBe(lineOf(input));
      expect(describersOf(input), state).toHaveLength(2);
      // The boxes are decoration.
      const row = boxesOf(input)[0]?.parentElement;
      expect(row?.getAttribute('aria-hidden'), state).toBe('true');
      expect(row?.contains(input), state).toBe(false);
    }
  });

  it('the row of boxes fits the narrowest phone between its gutters', () => {
    const wide = EMAIL_CODE_DIGITS * size.codeBox.width + (EMAIL_CODE_DIGITS - 1) * space.x2;
    expect(wide).toBeLessThanOrEqual(NARROW[0] - 2 * 16);
    // And where it is given less, the boxes give way together and the row stays inside.
    const input = draw(probe());
    expect(input.parentElement?.style.maxWidth).toBe('100%');
    for (const box of boxesOf(input)) {
      expect(box.style.flexShrink).toBe('1');
    }
  });
});
