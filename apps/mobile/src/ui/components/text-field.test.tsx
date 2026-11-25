import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, size, space } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { TextField } from './text-field';
import type { TextFieldProps } from './text-field';
import { GROUND, PREVIEW, STATES } from './text-field.fixtures';

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
  'placeholder',
  'filled',
  'helper',
  'error',
  'valid',
  'disabled',
  'email',
  'leadingIcon',
  'clearable',
  'count',
  'countAtMax',
  'multiline',
  'multilineLong',
  'longLabel',
  'focused',
] as const;

const ALL: Readonly<Record<StateName, TextFieldProps>> = STATES;

const COMPACT = [390, 844] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.field';
/** One line of the `body` role at 100% text. */
const LINE = 22;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one field, in place of whatever was drawn before, and gives back its input. */
function draw(props: TextFieldProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  renderWithProviders(<TextField {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** Renders a state of the fixtures as the gallery does, forced where the state is an interaction. */
function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  renderWithProviders(
    <InteractionPreview state={PREVIEW[state] ?? {}}>
      <TextField {...ALL[state]} />
    </InteractionPreview>,
    options,
  );
  return screen.getByTestId(ALL[state].testID);
}

/** A field under the probe id: a filled display name unless told otherwise. */
function probe(given: Partial<TextFieldProps> = {}): TextFieldProps {
  return {
    label: 'Display name',
    value: 'Dana Okafor',
    onChangeText: () => undefined,
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

/** The line under a field: what its input says describes it. */
function lineOf(input: HTMLElement): HTMLElement | null {
  const id = input.getAttribute('aria-describedby');
  return id === null ? null : document.querySelector<HTMLElement>(`[id="${id}"]`);
}

describe('TextField', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const input = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          const off = fixture.disabled === true;
          expect(input.tagName, name).toBe(fixture.kind === 'multiline' ? 'TEXTAREA' : 'INPUT');
          expect(input, name).toHaveProperty('value', fixture.value);
          // The body role at the text size in use, in the text color.
          expect(input.style.fontSize, name).toBe(`${String(16 * scale)}px`);
          expect(input.style.color, name).toBe(
            written(off ? color[theme].disabledText : color[theme].text),
          );
          const frame = frameOf(input);
          expect(frame.style.backgroundColor, name).toBe(
            written(off ? color[theme].disabledBg : color[theme].surface),
          );
          expect(frame.style.borderRadius, name).toBe('4px');
          expect(frame.style.outlineStyle, name).toBe(state === 'focused' ? 'solid' : '');
          if (fixture.labelHidden !== true) {
            expect(screen.getByText(fixture.label), name).toBeDefined();
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the sixteen states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.count.value).toHaveLength(118);
    expect(STATES.count.maxLength).toBe(160);
    expect(STATES.countAtMax.value).toHaveLength(160);
    expect(STATES.multilineLong.value.split('\n')).toHaveLength(12);
    expect(STATES.clearable.value).not.toBe('');
    expect(PREVIEW).toEqual({ focused: { focused: true } });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const input = drawState(state);
      const fixture = ALL[state];
      // A text box named by its label, whether the label is drawn or not.
      expect(screen.getByRole('textbox', { name: fixture.label }), state).toBe(input);
      expect(input.getAttribute('aria-label'), state).toBe(fixture.label);
      const labelledBy = input.getAttribute('aria-labelledby');
      if (fixture.labelHidden === true) {
        expect(labelledBy, state).toBeNull();
        expect(screen.queryByText(fixture.label), state).toBeNull();
      } else {
        expect(document.querySelector(`[id="${labelledBy ?? ''}"]`)?.textContent, state).toBe(
          fixture.label,
        );
      }
      // Its helper or its status sentence describes it.
      const sentence = fixture.statusText ?? fixture.helper;
      if (sentence !== undefined) {
        expect(lineOf(input)?.textContent, state).toContain(sentence);
      }
      // The icon in the frame is decoration.
      for (const icon of frameOf(input).querySelectorAll('svg')) {
        expect(icon.closest('[aria-hidden="true"]'), state).not.toBeNull();
      }
    }
    // The clear button is named from the catalog.
    const input = drawState('clearable');
    const clear = within(frameOf(input)).getByRole('button');
    expect(clear.getAttribute('aria-label')).toBe('Clear');
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const input = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(input.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // Everything a person can press or type into carries an id.
      const pressable = document.querySelectorAll('input, textarea, button, [role="button"]');
      for (const element of pressable) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
    drawState('clearable');
    expect(screen.getByTestId(`${STATES.clearable.testID}-clear`)).toBeDefined();
  });

  it('respects reduced motion', () => {
    // A text field has no motion of its own: a state is drawn at once, with motion or without.
    for (const reducedMotion of [false, true]) {
      for (const state of ['filled', 'error', 'valid', 'disabled', 'count', 'focused'] as const) {
        const input = drawState(state, { reducedMotion });
        for (const part of [input, frameOf(input), lineOf(input)]) {
          expect(part?.style.transform ?? '', state).toBe('');
          expect(part?.style.animationName ?? '', state).toBe('');
          expect(part?.style.transitionProperty ?? '', state).toBe('');
        }
      }
    }
  });

  it('the frame draws the ring, for a pointer and a keyboard alike, and the input draws none', () => {
    const input = draw(probe());
    const frame = frameOf(input);
    expect(frame.style.outlineStyle).toBe('');
    // The browser's own ring is taken off the input: two rings is a defect.
    expect(input.style.outlineWidth).toBe('0px');
    act(() => {
      input.focus();
    });
    expect(frameOf(input).style.outlineStyle).toBe('solid');
    expect(frameOf(input).style.outlineWidth).toBe(`${String(rule.focus)}px`);
    expect(frameOf(input).style.outlineColor).toBe(written(color.light.focusRing));
    expect(input.style.outlineWidth).toBe('0px');
    act(() => {
      input.blur();
    });
    expect(frameOf(input).style.outlineStyle).toBe('');
  });

  it('a press on the frame’s own room focuses the input', () => {
    const input = draw(probe());
    expect(document.activeElement).not.toBe(input);
    fireEvent.click(frameOf(input));
    expect(document.activeElement).toBe(input);
    // The frame itself is no stop on the way through the page.
    expect(frameOf(input).getAttribute('tabindex')).toBe('-1');
  });

  it('what is typed goes to the caller, who holds it', () => {
    const onChangeText = vi.fn();
    const input = draw(probe({ value: '', onChangeText }));
    fireEvent.change(input, { target: { value: 'Dana' } });
    expect(onChangeText).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenCalledWith('Dana');
  });

  it('the placeholder is drawn in the secondary color', () => {
    const input = drawState('placeholder');
    expect(input.getAttribute('placeholder')).toBe(STATES.placeholder.placeholder);
    expect(input.style.getPropertyValue('--placeholderTextColor')).toBe(color.light.textSecondary);
  });

  it('error and valid thicken the border in their color and show their sentence', () => {
    const failed = drawState('error');
    expect(frameOf(failed).style.borderWidth).toBe(`${String(rule.fieldState)}px`);
    expect(frameOf(failed).style.borderColor).toBe(written(color.light.danger));
    expect(lineOf(failed)?.getAttribute('role')).toBe('alert');
    expect(lineOf(failed)?.textContent).toBe(STATES.error.statusText);
    expect(screen.queryByText(STATES.error.helper)).toBeNull();

    const passed = drawState('valid');
    expect(frameOf(passed).style.borderWidth).toBe(`${String(rule.fieldState)}px`);
    expect(frameOf(passed).style.borderColor).toBe(written(color.light.success));
    expect(lineOf(passed)?.getAttribute('role')).toBeNull();
    expect(lineOf(passed)?.textContent).toBe(STATES.valid.statusText);
  });

  it('clear button', () => {
    const onClear = vi.fn();
    const input = draw(probe({ value: 'county clerk', onClear }));
    const clear = screen.getByTestId(`${PROBE}-clear`);
    expect(clear.getAttribute('aria-label')).toBe('Clear');
    expect(clear.getAttribute('role') ?? clear.tagName.toLowerCase()).toBe('button');
    // The small icon button, at the end of the frame, after the input.
    expect(input.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(frameOf(input).contains(clear)).toBe(true);
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
    // The field is ready for the next words.
    expect(document.activeElement).toBe(input);

    // With nothing to clear, and in a field that is off, there is no button.
    draw(probe({ value: '', onClear }));
    expect(screen.queryByTestId(`${PROBE}-clear`)).toBeNull();
    draw(probe({ value: 'county clerk', onClear, disabled: true }));
    expect(screen.queryByTestId(`${PROBE}-clear`)).toBeNull();
    draw(probe({ value: 'county clerk' }));
    expect(screen.queryByTestId(`${PROBE}-clear`)).toBeNull();
  });

  it('count at the limit', () => {
    const below = drawState('count');
    const count = screen.getByText('118 / 160');
    expect(lineOf(below)?.contains(count)).toBe(true);
    expect(count.closest('[aria-live]')).toBeNull();
    expect(below.getAttribute('maxlength')).toBe('160');
    // Mono, tabular, secondary, at the end of the line.
    expect(count.style.fontSize).toBe('12px');
    expect(count.style.fontVariant).toContain('tabular-nums');
    expect(count.style.color).toBe(written(color.light.textSecondary));
    expect(lineOf(below)?.lastElementChild?.contains(count)).toBe(true);

    const at = drawState('countAtMax');
    const full = screen.getByText('160 / 160');
    expect(lineOf(at)?.contains(full)).toBe(true);
    expect(full.closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
    // The limit is said by the count alone, never as an alert.
    expect(lineOf(at)?.getAttribute('role')).toBeNull();
    expect(lineOf(at)?.getAttribute('aria-live')).toBeNull();
  });

  it('a count needs a limit, and a limit alone shows no count', () => {
    draw(probe({ showCount: true }));
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
    const input = draw(probe({ maxLength: 50 }));
    expect(input.getAttribute('maxlength')).toBe('50');
    expect(screen.queryByText(/\d+ \/ \d+/)).toBeNull();
    draw(probe({ maxLength: 50, showCount: true }));
    expect(screen.getByText('11 / 50')).toBeDefined();
  });

  it('email keyboard', () => {
    const input = drawState('email');
    expect(input.getAttribute('inputmode')).toBe('email');
    expect(input.getAttribute('autocapitalize')).toBe('none');
    expect(input.getAttribute('autocomplete')).toBe('email');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('type')).toBe('email');
  });

  it('each kind sets its keyboard and what the system may fill in', () => {
    const text = draw(probe());
    expect(text.getAttribute('inputmode')).toBe('text');
    expect(text.getAttribute('autocapitalize')).toBe('sentences');
    const url = draw(probe({ kind: 'url' }));
    expect(url.getAttribute('inputmode')).toBe('url');
    expect(url.getAttribute('autocomplete')).toBe('url');
    expect(url.getAttribute('autocapitalize')).toBe('none');
    expect(url.getAttribute('autocorrect')).toBe('off');
    const number = draw(probe({ kind: 'number', value: '27' }));
    expect(number.getAttribute('inputmode')).toBe('numeric');
    expect(number.getAttribute('autocapitalize')).toBe('none');
    const lines = draw(probe({ kind: 'multiline' }));
    expect(lines.tagName).toBe('TEXTAREA');
    expect(lines.getAttribute('autocapitalize')).toBe('sentences');
  });

  it('disabled', () => {
    const onChangeText = vi.fn();
    const input = draw(probe({ disabled: true, onChangeText }));
    expect(input).toHaveProperty('readOnly', true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    const frame = frameOf(input);
    expect(frame.style.backgroundColor).toBe(written(color.light.disabledBg));
    expect(frame.style.borderWidth).toBe('0px');
    expect(input.style.color).toBe(written(color.light.disabledText));
    // The text stands where it stood: the room takes back the hairline the border gave up.
    expect(frame.style.paddingLeft).toBe(`${String(space.x4 + rule.hairline)}px`);
    // No ring for a field that takes nothing.
    act(() => {
      input.focus();
    });
    expect(frameOf(input).style.outlineStyle).toBe('');

    const on = draw(probe());
    expect(on).toHaveProperty('readOnly', false);
    expect(on.getAttribute('aria-disabled')).toBeNull();
    expect(frameOf(on).style.borderWidth).toBe(`${String(rule.hairline)}px`);
  });

  it('submit', () => {
    const onSubmit = vi.fn();
    const input = draw(probe({ submitLabel: 'next', onSubmit }));
    expect(input.getAttribute('enterkeyhint')).toBe('next');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Shift and Enter is not a submit.
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'a' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    for (const submitLabel of ['done', 'search', 'send'] as const) {
      expect(draw(probe({ submitLabel })).getAttribute('enterkeyhint')).toBe(submitLabel);
    }
  });

  it('the leading icon is medium, in the secondary color, before the text', () => {
    const input = drawState('leadingIcon');
    const icon = frameOf(input).querySelector('svg')?.closest<HTMLElement>('[aria-hidden="true"]');
    expect(icon?.style.width).toBe(`${String(size.icon.medium)}px`);
    if (icon === null || icon === undefined) {
      throw new Error('the frame draws no icon');
    }
    expect(icon.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const strokes = [...frameOf(input).querySelectorAll('svg [stroke]')]
      .map((shape) => shape.getAttribute('stroke'))
      .filter((stroke) => stroke !== null && stroke !== 'none');
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) {
      expect(written(stroke ?? '')).toBe(written(color.light.textSecondary));
    }
  });

  it('a multiline field is as tall as its text, from 3 lines to 8, and never a fixed height', () => {
    const input = drawState('multiline');
    const row = input.parentElement;
    expect(row?.style.minHeight).toBe(`${String(3 * LINE)}px`);
    expect(row?.style.maxHeight).toBe(`${String(8 * LINE)}px`);
    expect(row?.style.height).toBe('');
    expect(input.style.height).toBe('');
    expect(input.style.maxHeight).toBe(`${String(8 * LINE)}px`);
    // The row grows with an unseen copy of the text, in the same style and the same width.
    const copy = row?.firstElementChild;
    if (!(copy instanceof HTMLElement)) {
      throw new Error('the row holds no copy of the text');
    }
    expect(copy).not.toBe(input);
    expect(copy.style.opacity).toBe('0');
    expect(copy.style.fontSize).toBe(input.style.fontSize);
    expect(copy.style.lineHeight).toBe(input.style.lineHeight);
    expect(copy.getAttribute('aria-hidden')).toBe('true');
    expect(copy.style.width).toBe('100%');

    const long = drawState('multilineLong');
    expect(long.parentElement?.firstElementChild?.textContent).toBe(
      `${STATES.multilineLong.value}\u200B`,
    );
    // The lines grow with the text size.
    const larger = drawState('multiline', { textScale: 1.3 });
    expect(Number.parseFloat(larger.parentElement?.style.minHeight ?? '')).toBeCloseTo(
      3 * LINE * 1.3,
    );
    // One line has no such row: it stands in the middle of the frame.
    const one = drawState('filled');
    expect(one.parentElement).toBe(frameOf(one));
  });

  it('autoFocus passes through', () => {
    const input = draw(probe({ autoFocus: true }));
    expect(document.activeElement).toBe(input);
    expect(frameOf(input).style.outlineStyle).toBe('solid');
  });
});
