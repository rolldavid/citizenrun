import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size } from '@/ui/tokens';

import { RadioGroup } from './radio-group';
import type { RadioGroupProps } from './radio-group';
import { GROUND, PREVIEW, STATES } from './radio-group.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'noneSelected',
  'selected',
  'withHelpers',
  'labelHidden',
  'nineOptions',
] as const;

const ALL: Readonly<Record<StateName, RadioGroupProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.theme';
const THEMES = STATES.selected.options;
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

/** Renders one state of the fixtures and gives back its group. */
function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<RadioGroup {...ALL[state]} />, options);
  return screen.getByRole('radiogroup');
}

/** Renders the theme choice under the probe id; the caller's `onChange` hears every change. */
function draw(value: string | null, onChange: (value: string) => void = () => undefined): void {
  cleanup();
  renderWithProviders(
    <RadioGroup label="Theme" value={value} options={THEMES} onChange={onChange} testID={PROBE} />,
  );
}

/** The theme choice held as a screen holds it, so a change is drawn. */
function Held({ onChange }: { onChange: (value: string) => void }): JSX.Element {
  const [value, setValue] = useState<string | null>(null);
  return (
    <RadioGroup
      label="Theme"
      value={value}
      options={THEMES}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      testID={PROBE}
    />
  );
}

function option(value: string): HTMLElement {
  return screen.getByTestId(`${PROBE}-${value}`);
}

/** Gives the option focus, as Tab does. */
function focus(value: string): HTMLElement {
  const target = option(value);
  act(() => {
    target.focus();
  });
  return target;
}

/** The values of the options in the Tab order. */
function tabStops(): string[] {
  return screen
    .getAllByRole('radio')
    .filter((radio) => radio.getAttribute('tabindex') === '0')
    .map((radio) => radio.getAttribute('data-testid') ?? '');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RadioGroup', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const group = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          const radios = within(group).getAllByRole('radio');
          // One row for each option, in order, and only the chosen one checked.
          expect(
            radios.map((radio) => radio.getAttribute('aria-label')),
            name,
          ).toEqual(fixture.options.map((each) => each.label));
          expect(
            radios.map((radio) => radio.getAttribute('aria-checked') === 'true'),
            name,
          ).toEqual(fixture.options.map((each) => each.value === fixture.value));
          for (const each of fixture.options) {
            expect(within(group).getByText(each.label), name).toBeDefined();
            if (each.helper !== undefined) {
              expect(within(group).getByText(each.helper), name).toBeDefined();
            }
          }
          // A soft rule between the rows, and none before the first or after the last.
          const rules = [...group.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter(
            (part) => part.style.height === '1px',
          );
          expect(rules, name).toHaveLength(fixture.options.length - 1);
          for (const each of rules) {
            expect(each.style.backgroundColor, name).toBe(written(color[theme].ruleSoft));
            expect(each.previousElementSibling?.getAttribute('role'), name).toBe('radio');
            expect(each.nextElementSibling?.getAttribute('role'), name).toBe('radio');
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the five states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.radio-group-${kebab(state)}`);
    }
    // The theme choice, with nothing chosen for the person.
    expect(STATES.noneSelected.value).toBeNull();
    expect(STATES.noneSelected.options.map((each) => each.value)).toEqual([
      'system',
      'light',
      'dark',
    ]);
    expect(STATES.noneSelected.options.map((each) => each.label)).toEqual([
      'System',
      'Light',
      'Dark',
    ]);
    expect(STATES.withHelpers.options.every((each) => each.helper.length > 0)).toBe(true);
    expect(STATES.labelHidden.labelHidden).toBe(true);
    expect(STATES.nineOptions.options).toHaveLength(9);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const group = drawState(state);
      const fixture = ALL[state];
      // The group is named by its label, whether the label is drawn or not.
      expect(screen.getByRole('radiogroup', { name: fixture.label }), state).toBe(group);
      if (fixture.labelHidden === true) {
        expect(screen.queryByText(fixture.label), state).toBeNull();
      } else {
        // Drawn above the rows, in the label role.
        const label = screen.getByText(fixture.label);
        expect(label.style.fontSize, state).toBe('14px');
        expect(group.firstElementChild?.contains(label), state).toBe(true);
        expect(
          group.firstElementChild instanceof HTMLElement
            ? group.firstElementChild.style.marginBottom
            : '',
          state,
        ).toBe('8px');
      }
      for (const each of fixture.options) {
        expect(within(group).getByRole('radio', { name: each.label }), state).toBeDefined();
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const group = drawState(state);
      const fixture = ALL[state];
      expect(fixture.testID, state).toMatch(TEST_ID);
      expect(group.getAttribute('data-testid'), state).toBe(fixture.testID);
      for (const radio of within(group).getAllByRole('radio')) {
        expect(radio.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      const group = drawState(state, { reducedMotion: true });
      for (const part of [group, ...group.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
        expect(part.style.transition, state).toBe('');
        expect(part.style.opacity, state).toBe('');
      }
    }
  });

  it('option ids', () => {
    const group = drawState('selected');
    const id = STATES.selected.testID;
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('data-testid')),
    ).toEqual([`${id}-system`, `${id}-light`, `${id}-dark`]);
    // The id is on the press target itself: the whole row of the option.
    const light = screen.getByTestId(`${id}-light`);
    expect(light.getAttribute('role')).toBe('radio');
    expect(light.getAttribute('aria-checked')).toBe('true');
    expect(light.querySelector<HTMLElement>('[style*="min-height"]')?.style.minHeight).toBe(
      `${String(size.target)}px`,
    );
  });

  it('one Tab stop', () => {
    drawState('selected');
    expect(tabStops()).toEqual([`${STATES.selected.testID}-light`]);
    drawState('noneSelected');
    expect(tabStops()).toEqual([`${STATES.noneSelected.testID}-system`]);
    drawState('nineOptions');
    expect(tabStops()).toEqual([`${STATES.nineOptions.testID}-deadline`]);
    // Every other option is out of the Tab order and still takes a press and focus from code.
    drawState('selected');
    for (const radio of screen.getAllByRole('radio')) {
      expect(['0', '-1']).toContain(radio.getAttribute('tabindex'));
      expect(radio.getAttribute('aria-disabled')).toBeNull();
    }
    // A value that is none of the options leaves the first one as the stop.
    draw('sepia');
    expect(tabStops()).toEqual([`${PROBE}-system`]);
    // The group itself is no stop.
    expect(screen.getByRole('radiogroup').hasAttribute('tabindex')).toBe(false);
  });

  it('arrows move and wrap', () => {
    const onChange = vi.fn();
    // From the last, Down goes round to the first.
    draw('dark', onChange);
    expect(fireEvent.keyDown(focus('dark'), { key: 'ArrowDown' })).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('system');
    expect(document.activeElement).toBe(option('system'));
    // From the first, Up goes round to the last.
    draw('system', onChange);
    expect(fireEvent.keyDown(focus('system'), { key: 'ArrowUp' })).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('dark');
    expect(document.activeElement).toBe(option('dark'));
    // Right is Down and Left is Up.
    draw('system', onChange);
    fireEvent.keyDown(focus('system'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('light');
    expect(document.activeElement).toBe(option('light'));
    draw('light', onChange);
    fireEvent.keyDown(focus('light'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('system');
    expect(document.activeElement).toBe(option('system'));
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('the arrows walk the whole group as the caller takes each choice', () => {
    const onChange = vi.fn();
    cleanup();
    renderWithProviders(<Held onChange={onChange} />);
    // Nothing is chosen: the first option is the stop, and Down chooses the one after it.
    fireEvent.keyDown(focus('system'), { key: 'ArrowDown' });
    expect(option('light').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(option('light'));
    expect(tabStops()).toEqual([`${PROBE}-light`]);
    fireEvent.keyDown(option('light'), { key: 'ArrowDown' });
    fireEvent.keyDown(option('dark'), { key: 'ArrowDown' });
    expect(onChange.mock.calls).toEqual([['light'], ['dark'], ['system']]);
    expect(document.activeElement).toBe(option('system'));
    expect(tabStops()).toEqual([`${PROBE}-system`]);
  });

  it('every other key is left alone', () => {
    const onChange = vi.fn();
    draw('light', onChange);
    const light = focus('light');
    for (const key of ['Tab', 'Home', 'End', 'a', 'Escape']) {
      expect(fireEvent.keyDown(light, { key }), key).toBe(true);
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(light);
  });

  it('a press chooses an option, with the selection haptic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    const onChange = vi.fn();
    draw(null, onChange);
    fireEvent.click(option('dark'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('dark');
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
    // The caller holds the choice: nothing is drawn as chosen until the caller says so.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('pressing the chosen option does nothing', () => {
    const onChange = vi.fn();
    draw('light', onChange);
    fireEvent.click(option('light'));
    const light = focus('light');
    fireEvent.keyDown(light, { key: ' ' });
    fireEvent.keyDown(light, { key: 'Enter' });
    fireEvent.keyUp(light, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    // An arrow that comes back to the chosen option tells the caller nothing either.
    cleanup();
    renderWithProviders(
      <RadioGroup
        label="Theme"
        value="light"
        options={[{ value: 'light', label: 'Light' }]}
        onChange={onChange}
        testID={PROBE}
      />,
    );
    fireEvent.keyDown(focus('light'), { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(option('light'));
  });
});
