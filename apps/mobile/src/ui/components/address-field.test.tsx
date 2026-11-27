import { GEO_QUERY_MIN, GEO_SUGGESTIONS_MAX } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, radius, rule, size } from '@/ui/tokens';

import { ADDRESS_QUIET_MS, AddressField } from './address-field';
import type { AddressFieldProps } from './address-field';
import { GROUND, PREVIEW, STATES } from './address-field.fixtures';

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
  'typing',
  'loading',
  'ready',
  'readyLong',
  'unavailable',
  'usOnly',
  'zipInfo',
  'notCovered',
  'disabled',
] as const;

const ALL: Readonly<Record<StateName, AddressFieldProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const LABEL = 'Your address';
/** The states whose list shows rows. */
const WITH_ROWS: readonly StateName[] = ['ready', 'readyLong'];

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The field with what is typed held by its caller, as a screen holds it. */
function Held(props: AddressFieldProps): JSX.Element {
  const [value, setValue] = useState(props.value);
  return (
    <AddressField
      {...props}
      value={value}
      onChangeText={(next) => {
        setValue(next);
        props.onChangeText(next);
      }}
    />
  );
}

/** Renders one field, in place of whatever was drawn before, and gives back its input. */
function draw(props: AddressFieldProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<Held {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** Types into a field as a person does: the whole new text at once. */
function type(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
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

/** The four corner radii of a frame: top left, top right, bottom right, bottom left. */
function cornersOf(frame: HTMLElement): string[] {
  return [
    frame.style.borderTopLeftRadius,
    frame.style.borderTopRightRadius,
    frame.style.borderBottomRightRadius,
    frame.style.borderBottomLeftRadius,
  ];
}

/** The ids of the rows a screen reader hears as chosen. */
function selectedRows(): string[] {
  return screen
    .queryAllByRole('option')
    .filter((row) => row.getAttribute('aria-selected') === 'true')
    .map((row) => String(row.getAttribute('data-testid')));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AddressField', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const input = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          expect(input, name).toHaveProperty('value', props.value);
          expect(screen.getByText(LABEL), name).toBeTruthy();
          const frame = frameOf(input);
          if (props.disabled === true) {
            expect(frame.style.backgroundColor, name).toBe(written(color[theme].disabledBg));
            continue;
          }
          expect(frame.style.backgroundColor, name).toBe(written(color[theme].surface));
          const list = screen.queryByRole('listbox');
          if (list === null) continue;
          // The list on the surface, inside the same hairline as the frame on three sides.
          const box = list.parentElement;
          expect(box?.style.backgroundColor, name).toBe(written(color[theme].surface));
          expect(box?.style.borderBottomWidth, name).toBe(`${String(rule.hairline)}px`);
          expect(box?.style.borderLeftWidth, name).toBe(`${String(rule.hairline)}px`);
          expect(box?.style.borderRightWidth, name).toBe(`${String(rule.hairline)}px`);
          expect(box?.style.borderTopWidth, name).toBe('');
          expect(box?.style.borderBottomColor, name).toBe(written(color[theme].rule));
          expect(box?.style.borderBottomLeftRadius, name).toBe(`${String(radius.control)}px`);
          expect(box?.style.borderBottomRightRadius, name).toBe(`${String(radius.control)}px`);
          expect(box?.style.overflow, name).toBe('hidden');
          // In the flow under the frame, so it covers nothing.
          expect(box?.style.position, name).not.toBe('absolute');
          expect(frame.nextElementSibling, name).toBe(box);
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the ten states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.address-field-${kebab(state)}`);
    }
    expect(STATES.empty).toMatchObject({ value: '', suggestionsStatus: 'idle' });
    expect(STATES.typing).toMatchObject({ value: '10', suggestionsStatus: 'idle' });
    expect(STATES.loading).toMatchObject({ value: '100 Fix', suggestionsStatus: 'loading' });
    expect(STATES.ready).toMatchObject({ value: '100 Fix', suggestionsStatus: 'ready' });
    expect(STATES.ready.suggestions).toHaveLength(GEO_SUGGESTIONS_MAX);
    expect(STATES.ready.suggestions[0]).toEqual({
      id: 'fixture-address-1',
      primary: '100 Fixture Street',
      secondary: 'Fixture Wren County, ZZ 00001',
    });
    expect(STATES.ready.credits).toEqual([
      { text: 'Suggestions by Fixture Provider', href: 'https://provider.example/credit' },
      { text: 'Map data from Fixture Atlas', href: 'https://atlas.example/copyright' },
    ]);
    expect(STATES.readyLong.suggestions).toHaveLength(7);
    expect(STATES.unavailable).toMatchObject({
      value: '100 Fixture Street',
      suggestionsStatus: 'unavailable',
    });
    expect(STATES.usOnly.message).toEqual({ kind: 'error', text: 'United States only.' });
    expect(STATES.zipInfo.message).toEqual({
      kind: 'info',
      text: 'Based on your ZIP. Add your address for exact districts.',
    });
    expect(STATES.notCovered.message).toEqual({
      kind: 'error',
      text: "We don't cover Fixture Territory yet.",
    });
    expect(STATES.disabled.disabled).toBe(true);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const input = draw(ALL[state]);
      // A combo box named by its label.
      expect(screen.getByRole('combobox', { name: LABEL }), state).toBe(input);
      const labelledBy = input.getAttribute('aria-labelledby');
      expect(document.querySelector(`[id="${labelledBy ?? ''}"]`)?.textContent, state).toBe(LABEL);
      expect(input.getAttribute('aria-autocomplete'), state).toBe('list');
      // Its message describes it.
      const message = ALL[state].message;
      if (message !== undefined && message !== null) {
        expect(lineOf(input)?.textContent, state).toContain(message.text);
      }
      // Each row is named by its place, then the line under it.
      const rows = screen.queryAllByRole('option');
      expect(rows.length > 0, state).toBe(WITH_ROWS.includes(state));
      rows.forEach((row, index) => {
        const suggestion = ALL[state].suggestions[index];
        expect(row.getAttribute('aria-label'), state).toBe(
          suggestion?.secondary === null || suggestion?.secondary === undefined
            ? suggestion?.primary
            : `${suggestion.primary}. ${suggestion.secondary}`,
        );
        expect(within(row).getByText(String(suggestion?.primary)), state).toBeTruthy();
        // The pin beside it is decoration.
        for (const icon of row.querySelectorAll('svg')) {
          expect(icon.closest('[aria-hidden="true"]'), state).not.toBeNull();
        }
      });
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const input = draw(ALL[state]);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(input.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      const ids = [...document.querySelectorAll('[data-testid]')].map((part) =>
        String(part.getAttribute('data-testid')),
      );
      expect(new Set(ids).size, state).toBe(ids.length);
      // Everything a person can press or type into carries an id.
      for (const element of document.querySelectorAll('input, a, [role="option"], [role="link"]')) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
    draw(STATES.ready);
    for (let index = 0; index < GEO_SUGGESTIONS_MAX; index += 1) {
      expect(
        screen.getByTestId(`gallery.address-field-ready-option-${String(index)}`),
      ).toBeTruthy();
    }
    expect(screen.getByTestId('gallery.address-field-ready-credit-0')).toBeTruthy();
    expect(screen.getByTestId('gallery.address-field-ready-credit-1')).toBeTruthy();
  });

  it('respects reduced motion', () => {
    // The field has no motion of its own: the list is there or it is not, with motion or without.
    for (const reducedMotion of [false, true]) {
      for (const state of ['empty', 'ready', 'usOnly', 'zipInfo', 'disabled'] as const) {
        const input = draw(ALL[state], { reducedMotion });
        const list = screen.queryByRole('listbox');
        for (const part of [input, frameOf(input), lineOf(input), list, list?.parentElement]) {
          expect(part?.style.transform ?? '', state).toBe('');
          expect(part?.style.animationName ?? '', state).toBe('');
          expect(part?.style.transitionProperty ?? '', state).toBe('');
        }
      }
    }
    // The rows of a loading list hold still under reduced motion.
    draw(STATES.loading, { reducedMotion: true });
    for (const row of screen.getAllByRole('progressbar')) {
      expect(['', '1']).toContain(row.style.opacity);
      expect(row.style.animationName).toBe('');
    }
  });

  it('the field waits for three characters and 250 ms', () => {
    vi.useFakeTimers();
    expect(GEO_QUERY_MIN).toBe(3);
    expect(ADDRESS_QUIET_MS).toBe(250);
    const onQuery = vi.fn();
    const input = draw({ ...STATES.empty, onQuery });
    wait(1000);
    expect(onQuery).not.toHaveBeenCalled();

    // Two characters ask nothing, however long they stand.
    type(input, '10');
    wait(1000);
    expect(onQuery).not.toHaveBeenCalled();

    // Three ask once, a quarter second after the last change.
    type(input, '100');
    wait(ADDRESS_QUIET_MS - 1);
    expect(onQuery).not.toHaveBeenCalled();
    wait(1);
    expect(onQuery).toHaveBeenCalledTimes(1);
    expect(onQuery).toHaveBeenLastCalledWith('100');

    // Typing on restarts the wait: one call, with the last text.
    type(input, '100 F');
    wait(100);
    type(input, '100 Fi');
    wait(ADDRESS_QUIET_MS - 1);
    expect(onQuery).toHaveBeenCalledTimes(1);
    wait(1);
    expect(onQuery).toHaveBeenCalledTimes(2);
    expect(onQuery).toHaveBeenLastCalledWith('100 Fi');

    // Dropping under three says so at once.
    type(input, '10');
    expect(onQuery).toHaveBeenCalledTimes(3);
    expect(onQuery).toHaveBeenLastCalledWith(null);
    wait(1000);
    expect(onQuery).toHaveBeenCalledTimes(3);

    // And the same text asks again after the same wait.
    type(input, '100');
    wait(ADDRESS_QUIET_MS - 1);
    expect(onQuery).toHaveBeenCalledTimes(3);
    wait(1);
    expect(onQuery).toHaveBeenCalledTimes(4);
    expect(onQuery).toHaveBeenLastCalledWith('100');
    wait(1000);
    expect(onQuery).toHaveBeenCalledTimes(4);
  });

  it('the text is trimmed and counted in whole characters before it is asked', () => {
    vi.useFakeTimers();
    const onQuery = vi.fn();
    const input = draw({ ...STATES.empty, onQuery });
    // Spaces at the ends do not count.
    type(input, '  10  ');
    wait(1000);
    expect(onQuery).not.toHaveBeenCalled();
    type(input, ' 100 Fi ');
    wait(ADDRESS_QUIET_MS);
    expect(onQuery).toHaveBeenLastCalledWith('100 Fi');
    // A space more changes nothing that is asked.
    type(input, ' 100 Fi  ');
    wait(1000);
    expect(onQuery).toHaveBeenCalledTimes(1);
    // Two characters outside the basic plane are two characters, not four.
    type(input, '𝟙𝟘');
    expect(onQuery).toHaveBeenLastCalledWith(null);
    wait(1000);
    expect(onQuery).toHaveBeenCalledTimes(2);
  });

  it('provider credit shows', () => {
    draw(STATES.ready);
    const provider = screen.getByRole('link', {
      name: 'Suggestions by Fixture Provider, opens in your browser',
    });
    const atlas = screen.getByRole('link', {
      name: 'Map data from Fixture Atlas, opens in your browser',
    });
    expect(provider.getAttribute('href')).toBe('https://provider.example/credit');
    expect(atlas.getAttribute('href')).toBe('https://atlas.example/copyright');
    expect(provider.getAttribute('data-testid')).toBe('gallery.address-field-ready-credit-0');
    expect(atlas.getAttribute('data-testid')).toBe('gallery.address-field-ready-credit-1');
    // Under the rows, and outside the list a screen reader counts.
    const list = screen.getByRole('listbox');
    expect(list.contains(provider)).toBe(false);
    expect(list.parentElement?.contains(provider)).toBe(true);
    expect(list.compareDocumentPosition(provider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(provider).getByText('Suggestions by Fixture Provider').style.color).toBe(
      written(color.light.textSecondary),
    );

    // No rows, no credit.
    for (const state of ['loading', 'unavailable'] as const) {
      draw({ ...ALL[state], credits: STATES.ready.credits });
      expect(screen.queryByRole('link'), state).toBeNull();
      expect(screen.queryByText('Suggestions by Fixture Provider'), state).toBeNull();
    }
    // And rows with no credit given draw no line for one.
    draw({ ...STATES.ready, credits: [] });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(GEO_SUGGESTIONS_MAX);
  });

  it('at most five rows', () => {
    draw(STATES.readyLong);
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(GEO_SUGGESTIONS_MAX);
    // Each row is named by both its lines, in the order they are drawn, so what is seen is read.
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(
      STATES.readyLong.suggestions
        .slice(0, GEO_SUGGESTIONS_MAX)
        .map((row) => (row.secondary === null ? row.primary : `${row.primary}. ${row.secondary}`)),
    );
    expect(rows[0]?.getAttribute('aria-label')).toBe(
      '100 Fixture Street. Fixture Wren County, ZZ 00001',
    );
    expect(rows[3]?.getAttribute('aria-label')).toBe('100 Fixture Mill Road');
    for (const row of rows) {
      expect(row.getAttribute('aria-description')).toBeNull();
      expect(row.getAttribute('title')).toBeNull();
    }
    expect(screen.queryByText('100 Fixture Terrace')).toBeNull();
    // Each row is 44 high, with its pin, its place and the grey line under it.
    for (const row of rows) {
      expect(
        [...row.querySelectorAll<HTMLElement>('*')].some(
          (part) => part.style.minHeight === `${String(size.listRowCompact)}px`,
        ),
      ).toBe(true);
      expect(row.querySelector('svg')).not.toBeNull();
    }
    const secondary = within(rows[0] as HTMLElement).getByText('Fixture Wren County, ZZ 00001');
    expect(secondary.style.color).toBe(written(color.light.textSecondary));
    // A row with nothing under its place draws one line.
    expect(rows[3]?.textContent).toBe('100 Fixture Mill Road');
  });

  it('loading and unavailable', () => {
    const loading = draw(STATES.loading);
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(screen.queryByRole('option')).toBeNull();
    expect(loading.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox').getAttribute('aria-busy')).toBe('true');

    const unavailable = draw(STATES.unavailable);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(unavailable.getAttribute('aria-expanded')).toBe('false');
    // The typed address is still there to send.
    expect(unavailable).toHaveProperty('value', '100 Fixture Street');
  });

  it('messages', () => {
    for (const theme of ['light', 'dark'] as const) {
      const failed = draw(STATES.usOnly, { theme });
      const alert = lineOf(failed);
      expect(alert?.getAttribute('role')).toBe('alert');
      expect(alert?.textContent).toBe('United States only.');
      expect(within(alert as HTMLElement).getByText('United States only.').style.color).toBe(
        written(color[theme].danger),
      );
      // The warning icon in the color of the sentence, and the frame marked in it.
      const icon = alert?.querySelector('svg');
      expect(icon).not.toBeNull();
      const stroke =
        icon?.getAttribute('stroke') ?? icon?.querySelector('[stroke]')?.getAttribute('stroke');
      expect(written(stroke ?? '')).toBe(written(color[theme].danger));
      expect(frameOf(failed).style.borderColor).toBe(written(color[theme].danger));
      expect(frameOf(failed).style.borderWidth).toBe(`${String(rule.fieldState)}px`);

      const informed = draw(STATES.zipInfo, { theme });
      const helper = lineOf(informed);
      expect(helper?.getAttribute('role')).toBeNull();
      expect(helper?.querySelector('svg')).toBeNull();
      expect(
        within(helper as HTMLElement).getByText(
          'Based on your ZIP. Add your address for exact districts.',
        ).style.color,
      ).toBe(written(color[theme].textSecondary));
      expect(frameOf(informed).style.borderColor).toBe(written(color[theme].rule));
      expect(frameOf(informed).style.borderWidth).toBe(`${String(rule.hairline)}px`);
    }
    const uncovered = draw(STATES.notCovered);
    expect(lineOf(uncovered)?.getAttribute('role')).toBe('alert');
    expect(lineOf(uncovered)?.textContent).toBe("We don't cover Fixture Territory yet.");
    // With no message the field describes itself with nothing.
    expect(lineOf(draw(STATES.empty))).toBeNull();
  });

  it('combobox and listbox', () => {
    const ready = draw(STATES.ready);
    expect(ready.getAttribute('role')).toBe('combobox');
    expect(ready.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('listbox');
    expect(ready.getAttribute('aria-controls')).toBe(list.getAttribute('id'));
    expect(list.getAttribute('aria-label')).toBe(LABEL);
    const rows = within(list).getAllByRole('option');
    expect(rows).toHaveLength(GEO_SUGGESTIONS_MAX);
    // Focus stays in the input: no row is a stop on the way through the page.
    for (const row of rows) {
      expect(row.getAttribute('aria-selected')).toBe('false');
      expect(row.getAttribute('tabindex')).not.toBe('0');
    }
    // Nothing is highlighted, so the input names no row.
    expect(ready.getAttribute('aria-activedescendant')).toBeNull();

    const empty = draw(STATES.empty);
    expect(empty.getAttribute('role')).toBe('combobox');
    expect(empty.getAttribute('aria-expanded')).toBe('false');
    expect(empty.getAttribute('aria-controls')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    // Under three characters there is no list either.
    expect(draw(STATES.typing).getAttribute('aria-expanded')).toBe('false');
  });

  it('keys move, choose and close', () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    const input = draw({ ...STATES.ready, onSelect, onSubmit });
    const id = (index: number): string => `gallery.address-field-ready-option-${String(index)}`;

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selectedRows()).toEqual([id(0)]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selectedRows()).toEqual([id(1)]);
    // The input names the highlighted row, which is in the page.
    const active = input.getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(
      document.querySelector(`[id="${active ?? ''}"]`)?.contains(screen.getByTestId(id(1))),
    ).toBe(true);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selectedRows()).toEqual([id(0)]);
    // The highlighted row stands on the hover ground.
    expect(
      [...screen.getByTestId(id(0)).querySelectorAll<HTMLElement>('*')].some(
        (part) => part.style.backgroundColor === written(color.light.hoverBg),
      ),
    ).toBe(true);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('fixture-address-1');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    // The choice is said to a screen reader.
    expect(screen.getByRole('status').textContent).toBe('100 Fixture Street');

    // Typing again opens the list, with no row highlighted.
    type(input, '100 Fixt');
    expect(screen.getAllByRole('option')).toHaveLength(GEO_SUGGESTIONS_MAX);
    expect(selectedRows()).toEqual([]);
    expect(screen.getByRole('status').textContent).toBe('');

    // Up from the first row goes back to the text; Down stops at the last row.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selectedRows()).toEqual([]);
    for (let press = 0; press < GEO_SUGGESTIONS_MAX + 2; press += 1) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    expect(selectedRows()).toEqual([id(GEO_SUGGESTIONS_MAX - 1)]);

    // Escape closes the list and keeps what was typed.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveProperty('value', '100 Fixt');
    expect(onSelect).toHaveBeenCalledTimes(1);
    type(input, '100 Fixtu');
    expect(screen.getByRole('listbox')).toBeTruthy();

    // A press on a row chooses it too.
    fireEvent.click(screen.getByTestId(id(2)));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith('fixture-address-3');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the submit key sends the typed text', () => {
    const onSubmit = vi.fn();
    const onSelect = vi.fn();
    const unavailable = draw({ ...STATES.unavailable, onSubmit, onSelect });
    expect(unavailable.getAttribute('enterkeyhint')).toBe('search');
    fireEvent.keyDown(unavailable, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('100 Fixture Street');
    expect(onSelect).not.toHaveBeenCalled();

    // With rows and none highlighted, the typed text is sent, trimmed.
    const ready = draw({ ...STATES.ready, value: ' 100 Fix ', onSubmit, onSelect });
    fireEvent.keyDown(ready, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith('100 Fix');

    // With a highlighted row Enter selects instead.
    const chosen = draw({ ...STATES.ready, onSubmit, onSelect });
    fireEvent.keyDown(chosen, { key: 'ArrowDown' });
    fireEvent.keyDown(chosen, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('fixture-address-1');

    // An empty field sends nothing.
    const empty = draw({ ...STATES.empty, value: '   ', onSubmit, onSelect });
    fireEvent.keyDown(empty, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('the frame squares off over the list', () => {
    const control = `${String(radius.control)}px`;
    const none = `${String(radius.none)}px`;
    for (const state of ['ready', 'loading'] as const) {
      expect(cornersOf(frameOf(draw(ALL[state]))), state).toEqual([control, control, none, none]);
    }
    for (const state of ['empty', 'typing', 'unavailable', 'usOnly', 'disabled'] as const) {
      expect(cornersOf(frameOf(draw(ALL[state]))), state).toEqual([
        control,
        control,
        control,
        control,
      ]);
    }
    // Closed with Escape, the frame takes its corners back.
    const input = draw(STATES.ready);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(cornersOf(frameOf(input))).toEqual([control, control, control, control]);
  });

  it('never remembers', () => {
    const stored = vi.spyOn(Storage.prototype, 'setItem');
    const input = draw(STATES.ready);
    expect(input.getAttribute('autocomplete')).toBe('street-address');
    expect(input.getAttribute('autocorrect')).toBe('off');
    type(input, '100 Fixture Street');
    expect(input).toHaveProperty('value', '100 Fixture Street');

    // Unmounted and mounted again with nothing typed: an empty field and no list.
    const again = draw(STATES.empty);
    expect(again).toHaveProperty('value', '');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    expect(document.body.textContent).not.toContain('100 Fixture Street');
    expect(stored).not.toHaveBeenCalled();
    stored.mockRestore();
  });

  it('disabled asks nothing', () => {
    vi.useFakeTimers();
    const onQuery = vi.fn();
    const input = draw({
      ...STATES.disabled,
      value: '100 Fixture',
      suggestions: STATES.ready.suggestions,
      suggestionsStatus: 'ready',
      onQuery,
    });
    wait(1000);
    expect(onQuery).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input).toHaveProperty('readOnly', true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
  });
});
