import { cleanup, screen, within } from '@testing-library/react';
import type { JSX } from 'react';
import { TextInput } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, opacity, rule, size, space } from '@/ui/tokens';

import { FieldFrame } from './field-frame';
import type { FieldFrameProps } from './field-frame';
import { FieldShell, describedByProps, useFieldA11y } from './field-shell';
import type { FieldShellProps } from './field-shell';

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

const COMPACT = [390, 844] as const;

const LABEL = 'Display name';
const HELPER = 'The name people see on your posts.';
const SENTENCE = 'Use 2 characters or more.';
const CONTROL = 'probe.control';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** A control of a field: an input that takes the field's name and description. */
function Control(): JSX.Element {
  const { describedBy, ...named } = useFieldA11y();
  return <TextInput {...named} {...describedByProps(describedBy)} testID={CONTROL} />;
}

/** Renders one field round the probe control, in place of whatever was drawn before. */
function draw(
  given: Partial<FieldShellProps> = {},
  options: RenderWithProvidersOptions = {},
): HTMLElement {
  cleanup();
  setViewport(...COMPACT);
  const view = renderWithProviders(
    <FieldShell label={LABEL} status="none" announce="alert" {...given}>
      <Control />
    </FieldShell>,
    options,
  );
  return view.container;
}

/** The line under the control: what the control says describes it. */
function lineOf(container: HTMLElement): HTMLElement {
  const id = screen.getByTestId(CONTROL).getAttribute('aria-describedby');
  const line = id === null ? null : container.querySelector<HTMLElement>(`[id="${id}"]`);
  if (line === null) {
    throw new Error('the field draws no line');
  }
  return line;
}

/** Renders one frame round a word, and gives the frame back. */
function drawFrame(
  given: Partial<FieldFrameProps> = {},
  options: RenderWithProvidersOptions = {},
): HTMLElement {
  cleanup();
  const view = renderWithProviders(
    <FieldFrame status="none" focused={false} {...given}>
      <TextInput testID={CONTROL} />
    </FieldFrame>,
    options,
  );
  const frame = view.container.querySelector<HTMLElement>('[style*="min-height"]');
  if (frame === null) {
    throw new Error('no frame was drawn');
  }
  return frame;
}

describe('FieldShell', () => {
  it('draws the label, the control and the helper in that order', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      const container = draw({ helper: HELPER }, { theme });
      const label = within(container).getByText(LABEL);
      const helper = within(container).getByText(HELPER);
      const control = screen.getByTestId(CONTROL);
      expect(label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(control.compareDocumentPosition(helper) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
        0,
      );
      expect(label.style.color).toBe(written(color[theme].text));
      expect(label.style.fontSize).toBe('14px');
      expect(helper.style.color).toBe(written(color[theme].textSecondary));
      expect(helper.style.fontSize).toBe('13px');
      // The label stands `space.x2` over the control and the line `space.x2` under it.
      expect(label.closest<HTMLElement>('[id]')?.style.marginBottom).toBe(`${String(space.x2)}px`);
      expect(lineOf(container).style.marginTop).toBe(`${String(space.x2)}px`);
      expect(container.querySelector('svg')).toBeNull();
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('names the control with the label and describes it with the line', () => {
    const container = draw({ helper: HELPER });
    const control = screen.getByTestId(CONTROL);
    expect(control.getAttribute('aria-label')).toBe(LABEL);
    const labelledBy = control.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    expect(container.querySelector(`[id="${labelledBy ?? ''}"]`)?.textContent).toBe(LABEL);
    expect(lineOf(container).textContent).toBe(HELPER);
    // The two ids are the field's own, and no two fields share them.
    expect(control.getAttribute('aria-describedby')).not.toBe(labelledBy);
  });

  it('status replaces helper', () => {
    for (const theme of ['light', 'dark'] as const) {
      const container = draw({ helper: HELPER, status: 'error', statusText: SENTENCE }, { theme });
      expect(within(container).queryByText(HELPER)).toBeNull();
      const sentence = within(container).getByText(SENTENCE);
      expect(sentence.style.color).toBe(written(color[theme].danger));
      expect(sentence.style.fontSize).toBe('13px');
      const line = lineOf(container);
      expect(line.getAttribute('role')).toBe('alert');
      expect(line.getAttribute('aria-live')).toBe('assertive');
      expect(line.textContent).toBe(SENTENCE);
      // The warning icon, small, hidden, in the color of the sentence.
      const icons = line.querySelectorAll('svg');
      expect(icons).toHaveLength(1);
      const icon = icons[0]?.closest<HTMLElement>('[aria-hidden="true"]');
      expect(icon?.style.width).toBe(`${String(size.icon.small)}px`);
      const strokes = [...line.querySelectorAll('svg [stroke]')]
        .map((shape) => shape.getAttribute('stroke'))
        .filter((stroke) => stroke !== null && stroke !== 'none');
      expect(strokes.length).toBeGreaterThan(0);
      for (const stroke of strokes) {
        expect(written(stroke ?? '')).toBe(written(color[theme].danger));
      }
    }
  });

  it('a valid line takes the check icon in success and is no alert', () => {
    const errorIcon = draw({ status: 'error', statusText: SENTENCE }).querySelector('svg');
    const warning = errorIcon?.innerHTML;
    const container = draw({ helper: HELPER, status: 'valid', statusText: 'That one is free.' });
    expect(within(container).queryByText(HELPER)).toBeNull();
    const sentence = within(container).getByText('That one is free.');
    expect(sentence.style.color).toBe(written(color.light.success));
    const line = lineOf(container);
    expect(line.getAttribute('role')).toBeNull();
    expect(line.getAttribute('aria-live')).toBeNull();
    const check = line.querySelector('svg')?.innerHTML;
    expect(check).toBeDefined();
    expect(check).not.toBe(warning);
  });

  it('a status with no sentence keeps the helper', () => {
    const container = draw({ helper: HELPER, status: 'error' });
    expect(within(container).getByText(HELPER)).toBeDefined();
    expect(lineOf(container).getAttribute('role')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('polite announce', () => {
    const container = draw({
      announce: 'polite',
      status: 'valid',
      statusText: 'That one is free.',
    });
    const line = lineOf(container);
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(line.getAttribute('role')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    // An error is said the same way: at the next pause, never as an alert.
    const failed = draw({ announce: 'polite', status: 'error', statusText: SENTENCE });
    expect(lineOf(failed).getAttribute('aria-live')).toBe('polite');
    expect(failed.querySelector('[role="alert"]')).toBeNull();
    // And so is the helper.
    expect(lineOf(draw({ announce: 'polite', helper: HELPER })).getAttribute('aria-live')).toBe(
      'polite',
    );
  });

  it('labelHidden keeps the name', () => {
    const container = draw({ labelHidden: true, helper: HELPER });
    expect(within(container).queryByText(LABEL)).toBeNull();
    const control = screen.getByTestId(CONTROL);
    expect(control.getAttribute('aria-label')).toBe(LABEL);
    expect(control.getAttribute('aria-labelledby')).toBeNull();
    expect(screen.getByRole('textbox', { name: LABEL })).toBe(control);
  });

  it('draws no line with nothing to say, and an empty one when the line is reserved', () => {
    draw();
    expect(screen.getByTestId(CONTROL).getAttribute('aria-describedby')).toBeNull();
    const container = draw({ reserveLine: true });
    const line = lineOf(container);
    // A no-break space: the line keeps its height and says nothing.
    expect(line.textContent).toBe('\u00A0');
    expect(line.querySelector('svg')).toBeNull();
  });

  it('the trailing line stands at the end of the line, after the sentence', () => {
    const container = draw({ helper: HELPER, trailingLine: <TextInput testID="probe.count" /> });
    const line = lineOf(container);
    const trailing = screen.getByTestId('probe.count').parentElement;
    expect(line.lastElementChild).toBe(trailing);
    expect(trailing?.style.marginLeft).toBe(`${String(space.x3)}px`);
    expect(line.style.flexDirection).toBe('row');
    // With no sentence the count still has its line.
    const alone = draw({ trailingLine: <TextInput testID="probe.count" /> });
    expect(lineOf(alone).contains(screen.getByTestId('probe.count'))).toBe(true);
  });

  it('the icon’s box is as tall as one line of the sentence at the text size in use', () => {
    const container = draw({ status: 'error', statusText: SENTENCE });
    const box = container.querySelector('svg')?.closest('[aria-hidden="true"]')?.parentElement;
    const line = within(container).getByText(SENTENCE).style.lineHeight;
    expect(box?.style.minHeight).toBe(line);
    const larger = draw({ status: 'error', statusText: SENTENCE }, { textScale: 1.3 });
    const largerBox = larger.querySelector('svg')?.closest('[aria-hidden="true"]')?.parentElement;
    expect(largerBox?.style.minHeight).toBe(within(larger).getByText(SENTENCE).style.lineHeight);
    expect(largerBox?.style.minHeight).not.toBe(line);
  });

  it('a waiting line pulses, and is held at the low point under reduced motion', () => {
    const moving = draw({ helper: 'Checking', pulse: true });
    const pulsing = within(moving).getByText('Checking').closest<HTMLElement>('[style*="opacity"]');
    expect(pulsing?.style.opacity).toBe('1');
    const held = draw({ helper: 'Checking', pulse: true }, { reducedMotion: true });
    expect(
      within(held).getByText('Checking').closest<HTMLElement>('[style*="opacity"]')?.style.opacity,
    ).toBe(String(opacity.skeletonLow));
    // A line that waits for nothing is at full strength either way.
    const still = draw({ helper: HELPER }, { reducedMotion: true });
    const wrapper = within(still).getByText(HELPER).closest<HTMLElement>('[style*="opacity"]');
    expect(wrapper === null || wrapper.style.opacity === '1').toBe(true);
  });

  it('a control outside a field fails in development', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup();
    expect(() => renderWithProviders(<Control />)).toThrow(
      'useFieldA11y is read by a control inside a form field',
    );
    errors.mockRestore();
  });

  it('describedByProps joins the ids it is given and leaves the attribute out with none', () => {
    expect(describedByProps()).toEqual({});
    expect(describedByProps(undefined)).toEqual({});
    expect(describedByProps('a')).toEqual({ 'aria-describedby': 'a' });
    expect(describedByProps('a', undefined, 'b')).toEqual({ 'aria-describedby': 'a b' });
  });
});

describe('FieldFrame', () => {
  it('is a row at least an input high on the surface, inside a hairline', () => {
    for (const theme of ['light', 'dark'] as const) {
      const frame = drawFrame({}, { theme });
      expect(frame.style.minHeight).toBe(`${String(size.input)}px`);
      expect(frame.style.flexDirection).toBe('row');
      expect(frame.style.backgroundColor).toBe(written(color[theme].surface));
      expect(frame.style.borderWidth).toBe(`${String(rule.hairline)}px`);
      expect(frame.style.borderColor).toBe(written(color[theme].rule));
      expect(frame.style.paddingLeft).toBe(`${String(space.x4)}px`);
      expect(frame.style.outlineStyle).toBe('');
    }
  });

  it('a state thickens the border in its color and the text does not move', () => {
    const inner = (frame: HTMLElement): number =>
      Number.parseFloat(frame.style.borderWidth) + Number.parseFloat(frame.style.paddingLeft);
    const plain = inner(drawFrame());
    for (const [status, token] of [
      ['error', color.light.danger],
      ['valid', color.light.success],
    ] as const) {
      const frame = drawFrame({ status });
      expect(frame.style.borderWidth, status).toBe(`${String(rule.fieldState)}px`);
      expect(frame.style.borderColor, status).toBe(written(token));
      expect(inner(frame), status).toBe(plain);
      expect(
        Number.parseFloat(frame.style.borderWidth) + Number.parseFloat(frame.style.paddingTop),
        status,
      ).toBe(rule.hairline + space.x1);
    }
    // A disabled frame has the disabled fill and no border, whatever its state.
    const off = drawFrame({ disabled: true, status: 'error' });
    expect(off.style.borderWidth).toBe('0px');
    expect(off.style.backgroundColor).toBe(written(color.light.disabledBg));
    expect(inner(off)).toBe(plain);
  });

  it('the ring is drawn round the frame when it is focused', () => {
    const frame = drawFrame({ focused: true });
    expect(frame.style.outlineStyle).toBe('solid');
    expect(frame.style.outlineWidth).toBe(`${String(rule.focus)}px`);
    expect(frame.style.outlineColor).toBe(written(color.light.focusRing));
    expect(drawFrame().style.outlineStyle).toBe('');
  });

  it('the leading and the trailing parts stand at the ends, a gap from the text', () => {
    const frame = drawFrame({
      leading: <TextInput testID="probe.leading" />,
      trailing: <TextInput testID="probe.trailing" />,
    });
    expect(frame.style.gap).toBe(`${String(space.x2)}px`);
    expect([...frame.children].map((child) => child.getAttribute('data-testid'))).toEqual([
      'probe.leading',
      CONTROL,
      'probe.trailing',
    ]);
  });

  it('a press on the frame is handed on, and the frame is no stop for the keyboard', () => {
    const onPress = vi.fn();
    const frame = drawFrame({ onPress });
    expect(frame.getAttribute('tabindex')).toBe('-1');
    expect(frame.getAttribute('role')).toBeNull();
    expect(frame.style.cursor).toBe('auto');
    frame.click();
    expect(onPress).toHaveBeenCalledTimes(1);
    // A disabled frame hands nothing on.
    const off = drawFrame({ onPress, disabled: true });
    off.click();
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
