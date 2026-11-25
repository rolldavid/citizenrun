import { HANDLE_MAX } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, opacity, rule, size } from '@/ui/tokens';

import { HandleField } from './handle-field';
import type { HandleFieldProps } from './handle-field';
import { GROUND, PREVIEW, STATES } from './handle-field.fixtures';
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
  'idle',
  'checking',
  'free',
  'taken',
  'reserved',
  'invalid',
  'focused',
] as const;

const ALL: Readonly<Record<StateName, HandleFieldProps>> = STATES;

const COMPACT = [390, 844] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.handle';
const NO_BREAK_SPACE = '\u00A0';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one field, in place of whatever was drawn before, and gives back its input. */
function draw(props: HandleFieldProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  renderWithProviders(<HandleField {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** Renders a state of the fixtures as the gallery does, forced where the state is an interaction. */
function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  renderWithProviders(
    <InteractionPreview state={PREVIEW[state] ?? {}}>
      <HandleField {...ALL[state]} />
    </InteractionPreview>,
    options,
  );
  return screen.getByTestId(ALL[state].testID);
}

/** A field under the probe id: an empty handle that waits for nothing unless told otherwise. */
function probe(given: Partial<HandleFieldProps> = {}): HandleFieldProps {
  return {
    label: 'Handle',
    value: '',
    onChangeText: () => undefined,
    check: 'idle',
    statusText: null,
    testID: PROBE,
    ...given,
  };
}

/** The frame round an input: the row that is at least an input high. */
function frameOf(input: HTMLElement): HTMLElement {
  const frame = input.closest<HTMLElement>(`[style*="min-height: ${String(size.input)}px"]`);
  if (frame === null) {
    throw new Error('the input stands in no frame');
  }
  return frame;
}

/** The line under the field: what its input says describes it. */
function lineOf(input: HTMLElement): HTMLElement {
  const id = input.getAttribute('aria-describedby');
  const line = id === null ? null : document.querySelector<HTMLElement>(`[id="${id}"]`);
  if (line === null) {
    throw new Error('the field draws no line');
  }
  return line;
}

describe('HandleField', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const input = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          expect(input.tagName, name).toBe('INPUT');
          expect(input, name).toHaveProperty('value', ALL[state].value);
          expect(input.style.fontSize, name).toBe(`${String(16 * scale)}px`);
          const frame = frameOf(input);
          expect(frame.style.backgroundColor, name).toBe(written(color[theme].surface));
          expect(frame.style.outlineStyle, name).toBe(state === 'focused' ? 'solid' : '');
          // The sign before the handle, in the secondary color, at the size of the text.
          const sign = frame.firstElementChild;
          if (!(sign instanceof HTMLElement)) {
            throw new Error('the frame draws no sign');
          }
          expect(sign.textContent, name).toBe('@');
          expect(sign.style.color, name).toBe(written(color[theme].textSecondary));
          expect(sign.style.fontSize, name).toBe(input.style.fontSize);
          // The line is always there, so nothing under the field moves.
          expect(lineOf(input), name).toBeDefined();
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the six checks and the focused field', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATE_NAMES.map((state) => ALL[state].check)).toEqual([
      'idle',
      'checking',
      'free',
      'taken',
      'reserved',
      'invalid',
      'idle',
    ]);
    expect(STATES.idle.statusText).toBeNull();
    expect(STATES.checking.statusText).toBeNull();
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
      // The sign is drawn, not read out: the label says what the field is.
      expect(frameOf(input).firstElementChild?.getAttribute('aria-hidden'), state).toBe('true');
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const input = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(input.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // The input is the one thing a person types into or presses.
      expect(
        document.querySelectorAll('input, textarea, button, [role="button"]'),
        state,
      ).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    const low = String(opacity.skeletonLow);
    const waiting = (input: HTMLElement): HTMLElement | null =>
      screen.getByText('Checking').closest<HTMLElement>('[style*="opacity"]') ??
      lineOf(input).querySelector<HTMLElement>('[style*="opacity"]');
    // With motion the check line pulses, from full strength.
    const moving = drawState('checking');
    expect(waiting(moving)?.style.opacity).toBe('1');
    // Without it the line is held at the low point of the pulse while the check runs.
    const held = drawState('checking', { reducedMotion: true });
    expect(waiting(held)?.style.opacity).toBe(low);
    // Nothing of the field moves or grows in either case, and an answer is at full strength.
    for (const reducedMotion of [false, true]) {
      for (const state of STATE_NAMES) {
        const input = drawState(state, { reducedMotion });
        for (const part of [input, frameOf(input), lineOf(input)]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
        if (state !== 'checking') {
          for (const part of lineOf(input).querySelectorAll<HTMLElement>('[style*="opacity"]')) {
            expect(part.style.opacity, state).toBe('1');
          }
        }
      }
    }
  });

  it('lowercases as typed', () => {
    const onChangeText = vi.fn();
    const input = draw(probe({ onChangeText }));
    fireEvent.change(input, { target: { value: 'Ab@c' } });
    expect(onChangeText).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenLastCalledWith('abc');
    fireEvent.change(input, { target: { value: '@Jane-Doe!' } });
    expect(onChangeText).toHaveBeenLastCalledWith('janedoe');
    fireEvent.change(input, { target: { value: 'JANE_doe.27' } });
    expect(onChangeText).toHaveBeenLastCalledWith('jane_doe.27');
  });

  it('the input is set for a handle: no capitals, no correction, the system’s username', () => {
    const input = draw(probe());
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocomplete')).toBe('username');
    expect(input.getAttribute('maxlength')).toBe(String(HANDLE_MAX));
    expect(input.getAttribute('inputmode')).toBe('text');
    expect(input.style.outlineWidth).toBe('0px');
  });

  it('each check', () => {
    for (const theme of ['light', 'dark'] as const) {
      // Idle: an empty line, kept for the answer.
      const idle = drawState('idle', { theme });
      expect(lineOf(idle).textContent).toBe(NO_BREAK_SPACE);
      expect(lineOf(idle).getAttribute('aria-live')).toBe('polite');
      expect(frameOf(idle).style.borderWidth).toBe(`${String(rule.hairline)}px`);

      // Checking: the catalog's word, in the secondary color, and the frame as it was.
      const checking = drawState('checking', { theme });
      const word = screen.getByText('Checking');
      expect(lineOf(checking).contains(word)).toBe(true);
      expect(word.style.color).toBe(written(color[theme].textSecondary));
      expect(lineOf(checking).querySelector('svg')).toBeNull();
      expect(frameOf(checking).style.borderWidth).toBe(`${String(rule.hairline)}px`);
      expect(lineOf(checking).getAttribute('aria-live')).toBe('polite');

      // Free: the caller's sentence as the valid line.
      const free = drawState('free', { theme });
      const freeWords = screen.getByText(STATES.free.statusText);
      expect(lineOf(free).contains(freeWords)).toBe(true);
      expect(freeWords.style.color).toBe(written(color[theme].success));
      expect(frameOf(free).style.borderColor).toBe(written(color[theme].success));
      expect(frameOf(free).style.borderWidth).toBe(`${String(rule.fieldState)}px`);
      expect(lineOf(free).querySelectorAll('svg')).toHaveLength(1);
      expect(lineOf(free).getAttribute('aria-live')).toBe('polite');
      const check = lineOf(free).querySelector('svg')?.innerHTML;

      // Taken, reserved and invalid: the caller's sentence as the error line.
      for (const state of ['taken', 'reserved', 'invalid'] as const) {
        const input = drawState(state, { theme });
        const words = screen.getByText(STATES[state].statusText);
        expect(lineOf(input).contains(words), state).toBe(true);
        expect(words.style.color, state).toBe(written(color[theme].danger));
        expect(frameOf(input).style.borderColor, state).toBe(written(color[theme].danger));
        expect(frameOf(input).style.borderWidth, state).toBe(`${String(rule.fieldState)}px`);
        expect(lineOf(input).querySelectorAll('svg'), state).toHaveLength(1);
        expect(lineOf(input).querySelector('svg')?.innerHTML, state).not.toBe(check);
        // Said at the next pause, never as an alert: the answer changes as the person types.
        expect(lineOf(input).getAttribute('aria-live'), state).toBe('polite');
        expect(lineOf(input).getAttribute('role'), state).toBeNull();
        expect(document.querySelector('[role="alert"]'), state).toBeNull();
      }
    }
  });

  it('the line is the same element from one answer to the next', () => {
    cleanup();
    setViewport(...COMPACT);
    const view = renderWithProviders(<HandleField {...probe({ value: 'jomarsh' })} />);
    const line = lineOf(screen.getByTestId(PROBE));
    view.rerender(<HandleField {...probe({ value: 'jomarsh', check: 'checking' })} />);
    expect(lineOf(screen.getByTestId(PROBE))).toBe(line);
    expect(line.textContent).toBe('Checking');
    view.rerender(
      <HandleField
        {...probe({ value: 'jomarsh', check: 'free', statusText: 'That one is free.' })}
      />,
    );
    expect(lineOf(screen.getByTestId(PROBE))).toBe(line);
    expect(line.textContent).toBe('That one is free.');
    view.rerender(
      <HandleField
        {...probe({ value: 'jomarsh', check: 'taken', statusText: 'Taken. Try another.' })}
      />,
    );
    expect(lineOf(screen.getByTestId(PROBE))).toBe(line);
    expect(line.textContent).toBe('Taken. Try another.');
  });

  it('the frame draws the ring while the input is focused', () => {
    const input = draw(probe());
    expect(frameOf(input).style.outlineStyle).toBe('');
    act(() => {
      input.focus();
    });
    expect(frameOf(input).style.outlineStyle).toBe('solid');
    act(() => {
      input.blur();
    });
    expect(frameOf(input).style.outlineStyle).toBe('');
    // A press on the frame's own room, on the sign, hands the input the focus.
    fireEvent.click(frameOf(input));
    expect(document.activeElement).toBe(input);
  });
});
