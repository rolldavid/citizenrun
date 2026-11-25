import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { color, size } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { Select } from './select';
import type { SelectProps } from './select';
import { GROUND, PREVIEW, STATES } from './select.fixtures';

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
  'chosen',
  'helper',
  'error',
  'disabled',
  'longList',
  'hovered',
  'pressed',
  'focused',
] as const;

const ALL: Readonly<Record<StateName, SelectProps>> = STATES;

/** A window's width and height. */
type Window = readonly [number, number];

const COMPACT: Window = [390, 844];
const MEDIUM: Window = [820, 1180];
const EXPANDED: Window = [1440, 900];

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.sort';
const SORTS = STATES.chosen.options;
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];
const CHEVRON_DOWN = 'M5 9l7 7 7-7';
const CHECK = 'M5 12.500 10 17.500 19 7';

beforeEach(() => {
  vi.useFakeTimers();
  setViewport(...EXPANDED);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one state of the fixtures, inside its preview when it has one, and gives back its control. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): HTMLElement {
  cleanup();
  const element = <Select {...ALL[state]} />;
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

/** A select held as a screen holds it, so a choice is drawn; the caller's `onChange` hears it too. */
function Held({
  given,
  onChange,
}: {
  given: Partial<SelectProps>;
  onChange: (value: string) => void;
}): JSX.Element {
  const [value, setValue] = useState<string | null>(given.value ?? null);
  return (
    <Select
      label="Sort offices by"
      options={SORTS}
      placeholder="Choose an order"
      testID={PROBE}
      {...given}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

/** Renders a held select under the probe id and gives back its control. */
function draw(
  given: Partial<SelectProps> = {},
  onChange: (value: string) => void = () => undefined,
): HTMLElement {
  cleanup();
  renderWithProviders(<Held given={given} onChange={onChange} />);
  return screen.getByTestId(given.testID ?? PROBE);
}

/** The frame the control draws: the box of a text field. */
function frameOf(control: HTMLElement): HTMLElement {
  const frame = control.querySelector<HTMLElement>(
    `[style*="min-height: ${String(size.input)}px"]`,
  );
  if (frame === null) {
    throw new Error('the control draws no frame');
  }
  return frame;
}

function row(value: string, testID: string = PROBE): HTMLElement {
  return screen.getByTestId(`${testID}-${value}`);
}

/** A press and release of a key on the element that has the focus. */
function pressKey(key: string): boolean {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) {
    throw new Error('nothing has the focus');
  }
  const allowed = fireEvent.keyDown(focused, { key });
  fireEvent.keyUp(focused, { key });
  return allowed;
}

/** Lets an overlay that was closed leave the page. */
function leave(): void {
  act(() => {
    vi.advanceTimersByTime(Math.max(motion.duration.sheet, motion.duration.fade) + 100);
  });
}

/** The path data of the icons under an element, in the order they are drawn. */
function iconPaths(element: HTMLElement): (string | null)[] {
  return [...element.querySelectorAll('path')].map((path) => path.getAttribute('d'));
}

describe('Select', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const control = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          const off = fixture.disabled === true;
          const chosen = fixture.options.find((each) => each.value === fixture.value);
          // The frame of a text field.
          const frame = frameOf(control);
          expect(frame.style.backgroundColor, name).toBe(
            written(off ? color[theme].disabledBg : color[theme].surface),
          );
          expect(frame.style.borderRadius, name).toBe('4px');
          expect(frame.style.borderWidth, name).toBe(
            off ? '0px' : fixture.status === 'error' ? '2px' : '1px',
          );
          if (fixture.status === 'error') {
            expect(frame.style.borderColor, name).toBe(written(color[theme].danger));
          }
          expect(frame.style.outlineStyle, name).toBe(state === 'focused' ? 'solid' : '');
          // The chosen label in the text color, or the placeholder in the secondary color.
          const words = within(frame).getByText(chosen?.label ?? fixture.placeholder);
          expect(words.style.fontSize, name).toBe(`${String(16 * scale)}px`);
          expect(words.style.color, name).toBe(
            written(
              off
                ? color[theme].disabledText
                : chosen === undefined
                  ? color[theme].textSecondary
                  : color[theme].text,
            ),
          );
          // The chevron after the words: medium, in the secondary color.
          expect(iconPaths(frame), name).toEqual([CHEVRON_DOWN]);
          const chevron = frame.querySelector('svg');
          expect(chevron?.getAttribute('width'), name).toBe('20');
          expect(frame.querySelector('path')?.getAttribute('stroke'), name).toBe(
            off ? color[theme].disabledText : color[theme].textSecondary,
          );
          expect(frame.lastElementChild?.contains(chevron ?? null), name).toBe(true);
          // Closed until it is pressed.
          expect(control.getAttribute('aria-expanded'), name).toBe('false');
          expect(screen.queryByRole('dialog'), name).toBeNull();
          expect(screen.getByText(fixture.label), name).toBeDefined();
          const sentence = fixture.statusText ?? fixture.helper;
          if (sentence !== undefined) {
            expect(screen.getByText(sentence), name).toBeDefined();
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
      expect(ALL[state].testID, state).toBe(`gallery.select-${kebab(state)}`);
    }
    expect(STATES.empty.value).toBeNull();
    expect(STATES.error.status).toBe('error');
    expect(STATES.disabled.disabled).toBe(true);
    // A list as long as the states and territories.
    const regions = STATES.longList.options;
    expect(regions).toHaveLength(56);
    expect(regions[0]?.label).toBe('Fixture region 01');
    expect(regions[55]?.label).toBe('Fixture region 56');
    expect(new Set(regions.map((each) => each.value)).size).toBe(56);
    expect(PREVIEW).toEqual({
      hovered: { hovered: true },
      pressed: { pressed: true },
      focused: { focused: true },
    });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const control = drawState(state);
      const fixture = ALL[state];
      // A combo box named by the field's label, which is drawn above it.
      expect(screen.getByRole('combobox', { name: fixture.label }), state).toBe(control);
      expect(control.getAttribute('aria-label'), state).toBe(fixture.label);
      expect(screen.getByText(fixture.label).style.fontSize, state).toBe('14px');
      // The chevron is decoration.
      for (const icon of control.querySelectorAll('svg')) {
        expect(icon.closest('[aria-hidden="true"]'), state).not.toBeNull();
      }
    }
    // An error is said at once.
    drawState('error');
    expect(screen.getByRole('alert').textContent).toBe(STATES.error.statusText);
    // The list it opens is a list box of options, named as the field is.
    fireEvent.click(drawState('chosen'));
    const list = screen.getByRole('listbox', { name: STATES.chosen.label });
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.getAttribute('aria-label')),
    ).toEqual(SORTS.map((each) => each.label));
    expect(screen.getByRole('dialog', { name: STATES.chosen.label })).toBe(
      screen.getByTestId(`${STATES.chosen.testID}-popover`),
    );
    // On a phone it is a sheet titled by the label, holding a radio group named the same.
    setViewport(...COMPACT);
    fireEvent.click(drawState('chosen'));
    const sheet = screen.getByTestId(`${STATES.chosen.testID}-sheet`);
    expect(within(sheet).getByRole('heading', { name: STATES.chosen.label })).toBeDefined();
    const group = within(sheet).getByRole('radiogroup', { name: STATES.chosen.label });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('aria-label')),
    ).toEqual(SORTS.map((each) => each.label));
  });

  it('has a testID', () => {
    for (const width of [COMPACT, EXPANDED]) {
      setViewport(...width);
      for (const state of STATE_NAMES) {
        const control = drawState(state);
        const fixture = ALL[state];
        expect(fixture.testID, state).toMatch(TEST_ID);
        expect(control.getAttribute('data-testid'), state).toBe(fixture.testID);
        fireEvent.click(control);
        // Everything a person can press carries an id: the control, each row and what closes the list.
        const pressable = document.querySelectorAll(
          '[role="combobox"], [role="option"], [role="radio"], [role="button"], button',
        );
        expect(pressable.length, state).toBeGreaterThan(0);
        for (const element of pressable) {
          expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
        }
      }
    }
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      const control = drawState(state, { reducedMotion: true }, { pressed: true });
      for (const part of [control, ...control.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, state).toContain(part.style.transform);
      }
    }
    // The same press moves the control where motion is allowed.
    expect(
      drawState('pressed').querySelector<HTMLElement>('[style*="transform"]')?.style.transform,
    ).toBe(MOVED);
    // The list fades in and nothing of it moves, with reduced motion and without.
    for (const reducedMotion of [true, false]) {
      fireEvent.click(drawState('chosen', { reducedMotion }));
      const surface = screen.getByTestId(`${STATES.chosen.testID}-popover`);
      for (const part of [surface, ...surface.querySelectorAll<HTMLElement>('*')]) {
        expect(AT_REST, String(reducedMotion)).toContain(part.style.transform);
      }
    }
  });

  it('placeholder and no choice', () => {
    const onChange = vi.fn();
    for (const width of [EXPANDED, MEDIUM, COMPACT]) {
      setViewport(...width);
      const control = draw({}, onChange);
      const name = String(width[0]);
      expect(within(control).getByText('Choose an order'), name).toBeDefined();
      for (const each of SORTS) {
        expect(within(control).queryByText(each.label), name).toBeNull();
      }
      // Opening the list chooses nothing and draws nothing as chosen.
      fireEvent.click(control);
      expect(control.getAttribute('aria-expanded'), name).toBe('true');
      const options = screen.queryAllByRole(width === COMPACT ? 'radio' : 'option');
      expect(options, name).toHaveLength(SORTS.length);
      for (const option of options) {
        expect(option.getAttribute('aria-selected') === 'true', name).toBe(false);
        expect(option.getAttribute('aria-checked') === 'true', name).toBe(false);
        expect(iconPaths(option), name).toEqual([]);
      }
      expect(within(control).getByText('Choose an order'), name).toBeDefined();
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('compact opens a sheet', () => {
    setViewport(...COMPACT);
    const onChange = vi.fn();
    const control = draw({}, onChange);
    expect(screen.queryByTestId(`${PROBE}-sheet`)).toBeNull();
    fireEvent.click(control);
    const sheet = screen.getByTestId(`${PROBE}-sheet`);
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(screen.queryByTestId(`${PROBE}-popover`)).toBeNull();
    // The sheet holds a radio group, each option under the group's id.
    const group = within(sheet).getByRole('radiogroup');
    expect(group.getAttribute('data-testid')).toBe(`${PROBE}-options`);
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('data-testid')),
    ).toEqual(SORTS.map((each) => `${PROBE}-options-${each.value}`));
    // The label is the sheet's title, and is not drawn a second time over the rows.
    expect(within(sheet).getAllByText('Sort offices by')).toHaveLength(1);

    fireEvent.click(screen.getByTestId(`${PROBE}-options-pay`));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('pay');
    expect(control.getAttribute('aria-expanded')).toBe('false');
    leave();
    expect(screen.queryByTestId(`${PROBE}-sheet`)).toBeNull();
    // The control now holds what was chosen.
    expect(within(control).getByText('Pay, highest first')).toBeDefined();
    // Opened again, the choice is the checked option.
    fireEvent.click(control);
    expect(screen.getByTestId(`${PROBE}-options-pay`).getAttribute('aria-checked')).toBe('true');
  });

  it('a short list is a sheet as tall as its rows, and a long one has a height of its own', () => {
    setViewport(...COMPACT);
    fireEvent.click(draw({ value: 'pay' }));
    const short = screen.getByTestId(`${PROBE}-sheet`);
    expect(short.style.maxHeight).toBe('100%');
    expect(short.style.height).toBe('');
    // 56 regions: the sheet rests at its tallest and its list scrolls inside it.
    fireEvent.click(drawState('longList'));
    const tall = screen.getByTestId(`${STATES.longList.testID}-sheet`);
    expect(tall.style.height).toBe('100%');
    const group = within(tall).getByRole('radiogroup');
    expect(within(group).getAllByRole('radio')).toHaveLength(56);
    expect(
      screen
        .getByTestId(`${STATES.longList.testID}-options-region-31`)
        .getAttribute('aria-checked'),
    ).toBe('true');
    // Seven options are still a short list; eight are not.
    const eight = STATES.longList.options.slice(0, 8);
    fireEvent.click(draw({ options: eight.slice(0, 7) }));
    expect(screen.getByTestId(`${PROBE}-sheet`).style.height).toBe('');
    fireEvent.click(draw({ options: eight }));
    expect(screen.getByTestId(`${PROBE}-sheet`).style.height).toBe('100%');
  });

  it('wide opens a list', () => {
    for (const width of [EXPANDED, MEDIUM]) {
      setViewport(...width);
      const onChange = vi.fn();
      const control = draw({ value: 'name' }, onChange);
      const name = String(width[0]);
      expect(screen.queryByTestId(`${PROBE}-popover`), name).toBeNull();
      fireEvent.click(control);
      const popover = screen.getByTestId(`${PROBE}-popover`);
      expect(screen.queryByTestId(`${PROBE}-sheet`), name).toBeNull();
      const list = within(popover).getByRole('listbox');
      const options = within(list).getAllByRole('option');
      expect(
        options.map((option) => option.getAttribute('data-testid')),
        name,
      ).toEqual(SORTS.map((each) => `${PROBE}-${each.value}`));
      // The chosen row is selected, carries the check and has the focus; no other row does.
      expect(
        options.map((option) => option.getAttribute('aria-selected')),
        name,
      ).toEqual(['false', 'false', 'true', 'false']);
      expect(document.activeElement, name).toBe(row('name'));
      expect(iconPaths(row('name')), name).toEqual([CHECK]);
      expect(row('name').querySelector('svg')?.getAttribute('width'), name).toBe('20');
      expect(iconPaths(list), name).toEqual([CHECK]);
      // A row is a selected option, never a checked one.
      for (const option of options) {
        expect(option.getAttribute('aria-checked'), name).toBeNull();
      }
      // Opening told the caller nothing.
      expect(onChange, name).not.toHaveBeenCalled();

      fireEvent.click(row('level'));
      expect(onChange, name).toHaveBeenCalledTimes(1);
      expect(onChange, name).toHaveBeenLastCalledWith('level');
      expect(control.getAttribute('aria-expanded'), name).toBe('false');
      leave();
      expect(screen.queryByTestId(`${PROBE}-popover`), name).toBeNull();
      expect(within(control).getByText('Level, local first'), name).toBeDefined();
    }
  });

  it('the rows of the list are at least a compact row high, split by soft rules', () => {
    fireEvent.click(draw({ value: 'pay' }));
    const list = within(screen.getByTestId(`${PROBE}-popover`)).getByRole('listbox');
    for (const each of SORTS) {
      const box = row(each.value).querySelector<HTMLElement>('[style*="min-height"]');
      expect(box?.style.minHeight, each.value).toBe(`${String(size.listRowCompact)}px`);
      // The label stands 16 from the popover's edge: the room of the focus ring, then the row's own.
      expect(box?.style.paddingLeft, each.value).toBe('12px');
      expect(box?.style.paddingRight, each.value).toBe('12px');
      expect(within(row(each.value)).getByText(each.label).style.fontSize).toBe('16px');
    }
    expect(
      list.firstElementChild instanceof HTMLElement && list.firstElementChild.style.padding,
    ).toBe('4px');
    const rules = [...list.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter(
      (part) => part.style.height === '1px',
    );
    expect(rules).toHaveLength(SORTS.length - 1);
    for (const each of rules) {
      expect(each.style.backgroundColor).toBe(written(color.light.ruleSoft));
    }
    // The list stands under the control, as wide as it, with no padding of the popover's own.
    const scroller = screen.getByTestId(`${PROBE}-popover`).firstElementChild?.firstElementChild;
    expect(scroller instanceof HTMLElement ? scroller.style.padding : null).toBe('');
  });

  it('only the row with the focus is in the Tab order', () => {
    fireEvent.click(draw({ value: 'name' }));
    const stops = (): (string | null)[] =>
      screen
        .getAllByRole('option')
        .filter((option) => option.getAttribute('tabindex') === '0')
        .map((option) => option.getAttribute('data-testid'));
    expect(stops()).toEqual([`${PROBE}-name`]);
    pressKey('ArrowUp');
    expect(stops()).toEqual([`${PROBE}-pay`]);
    // With nothing chosen the first row has the focus.
    fireEvent.click(draw());
    expect(document.activeElement).toBe(row('deadline'));
    expect(stops()).toEqual([`${PROBE}-deadline`]);
  });

  it('keyboard list', () => {
    const onChange = vi.fn();
    const control = draw({ value: 'pay' }, onChange);
    act(() => {
      control.focus();
    });
    // Enter opens the list from the keyboard, and focus goes to the chosen row.
    pressKey('Enter');
    expect(control.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(row('pay'));

    // Down moves the focus and chooses nothing; Enter chooses the focused row.
    expect(pressKey('ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(row('name'));
    expect(onChange).not.toHaveBeenCalled();
    expect(row('pay').getAttribute('aria-selected')).toBe('true');
    pressKey('Enter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('name');
    expect(control.getAttribute('aria-expanded')).toBe('false');
    leave();
    expect(screen.queryByTestId(`${PROBE}-popover`)).toBeNull();
    // The list hands the focus back to the control.
    expect(document.activeElement).toBe(control);

    // Space opens it as well, and chooses the focused row.
    pressKey(' ');
    expect(document.activeElement).toBe(row('name'));
    // Home and End go to the first and the last row.
    expect(pressKey('End')).toBe(false);
    expect(document.activeElement).toBe(row('level'));
    expect(pressKey('Home')).toBe(false);
    expect(document.activeElement).toBe(row('deadline'));
    // Up and Down stop at the ends: the list does not go round.
    pressKey('ArrowUp');
    expect(document.activeElement).toBe(row('deadline'));
    pressKey('End');
    pressKey('ArrowDown');
    expect(document.activeElement).toBe(row('level'));
    pressKey('ArrowUp');
    expect(document.activeElement).toBe(row('name'));
    pressKey('ArrowUp');
    expect(pressKey(' ')).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('pay');
    leave();
    expect(document.activeElement).toBe(control);
    expect(within(control).getByText('Pay, highest first')).toBeDefined();
  });

  it('type-ahead', () => {
    // Every region starts with the same letter: the focus goes to the row after the focused one.
    const regions = STATES.longList;
    fireEvent.click(draw({ ...regions, value: 'region-31', testID: PROBE }));
    expect(document.activeElement).toBe(row('region-31'));
    expect(pressKey('f')).toBe(false);
    expect(document.activeElement).toBe(row('region-32'));
    expect(within(row('region-32')).getByText('Fixture region 32')).toBeDefined();
    // A capital finds the same rows, and from the last row the search goes round to the first.
    pressKey('End');
    expect(document.activeElement).toBe(row('region-56'));
    pressKey('F');
    expect(document.activeElement).toBe(row('region-01'));
    // A letter no label starts with moves nothing, and typing chooses nothing.
    pressKey('z');
    expect(document.activeElement).toBe(row('region-01'));
    expect(row('region-31').getAttribute('aria-selected')).toBe('true');

    // Labels that start differently: each letter goes to its own row.
    fireEvent.click(draw({ value: 'deadline' }));
    pressKey('l');
    expect(document.activeElement).toBe(row('level'));
    pressKey('P');
    expect(document.activeElement).toBe(row('pay'));
    pressKey('o');
    expect(document.activeElement).toBe(row('name'));
    // The one row a letter matches keeps the focus.
    pressKey('o');
    expect(document.activeElement).toBe(row('name'));
    // A key with a name, and a shortcut, are no letters.
    expect(pressKey('Shift')).toBe(true);
    expect(pressKey('Tab')).toBe(true);
    const focused = document.activeElement;
    expect(
      focused instanceof HTMLElement && fireEvent.keyDown(focused, { key: 'f', metaKey: true }),
    ).toBe(true);
    expect(document.activeElement).toBe(row('name'));
  });

  it('Esc and a press outside close the list, choose nothing and hand the focus back', () => {
    const onChange = vi.fn();
    const control = draw({ value: 'pay' }, onChange);
    act(() => {
      control.focus();
    });
    pressKey('Enter');
    pressKey('ArrowDown');
    expect(document.activeElement).toBe(row('name'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(control.getAttribute('aria-expanded')).toBe('false');
    leave();
    expect(screen.queryByTestId(`${PROBE}-popover`)).toBeNull();
    expect(document.activeElement).toBe(control);
    expect(within(control).getByText('Pay, highest first')).toBeDefined();

    // Opened again, focus starts on the chosen row, not where it was left.
    pressKey('Enter');
    expect(document.activeElement).toBe(row('pay'));
    fireEvent.click(screen.getByTestId(`${PROBE}-popover-backdrop`));
    expect(control.getAttribute('aria-expanded')).toBe('false');
    leave();
    expect(screen.queryByTestId(`${PROBE}-popover`)).toBeNull();
    expect(document.activeElement).toBe(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a row pressed while the list leaves is no second choice', () => {
    const onChange = vi.fn();
    fireEvent.click(draw({ value: 'pay' }, onChange));
    fireEvent.click(row('name'));
    // The list is fading out and its rows are still on the page.
    fireEvent.click(row('level'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('name');
  });

  it('a chosen row far down the list is brought into view once the list has its place', () => {
    fireEvent.click(drawState('longList'));
    const chosen = row('region-31', STATES.longList.testID);
    const scrollIntoView = vi.fn();
    chosen.scrollIntoView = scrollIntoView;
    // jsdom lays nothing out, so the handler the page keeps on the list is called directly.
    const list = screen.getByRole('listbox').firstElementChild;
    const handler: unknown = list === null ? null : Reflect.get(list, '__reactLayoutHandler');
    expect(typeof handler).toBe('function');
    const layOut = (): void => {
      act(() => {
        Reflect.apply(handler as () => void, list, [
          { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 2500 } } },
        ]);
        vi.advanceTimersByTime(50);
      });
    };
    layOut();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    // Once for each opening: a later layout leaves the list where the person scrolled it.
    layOut();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('disabled', () => {
    for (const width of [EXPANDED, COMPACT]) {
      setViewport(...width);
      const onChange = vi.fn();
      const control = draw({ value: 'pay', disabled: true }, onChange);
      const name = String(width[0]);
      fireEvent.click(control);
      fireEvent.keyDown(control, { key: 'Enter' });
      fireEvent.keyUp(control, { key: 'Enter' });
      fireEvent.keyDown(control, { key: ' ' });
      expect(screen.queryByTestId(`${PROBE}-sheet`), name).toBeNull();
      expect(screen.queryByTestId(`${PROBE}-popover`), name).toBeNull();
      expect(screen.queryByRole('dialog'), name).toBeNull();
      expect(control.getAttribute('aria-expanded'), name).toBe('false');
      // Out of the Tab order, said to be off, and drawn off.
      expect(control.getAttribute('aria-disabled'), name).toBe('true');
      expect(control.getAttribute('tabindex'), name).toBe('-1');
      expect(frameOf(control).style.backgroundColor, name).toBe(written(color.light.disabledBg));
      expect(onChange, name).not.toHaveBeenCalled();
    }
  });

  it('never a native select', () => {
    for (const width of [EXPANDED, COMPACT]) {
      setViewport(...width);
      fireEvent.click(drawState('longList'));
      expect(document.querySelector('select, option, datalist')).toBeNull();
    }
  });
});
