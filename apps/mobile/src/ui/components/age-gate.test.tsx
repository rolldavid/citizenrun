import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import type * as UseBreakpoint from '@/ui/shells/use-breakpoint';
import { color } from '@/ui/tokens';

import { AgeGate } from './age-gate';
import type { AgeGateProps } from './age-gate';
import { GROUND, PREVIEW, STATES } from './age-gate.fixtures';

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

// The layout the gate and its selects read: a phone unless a case widens it, tight or not as a
// case sets it.
const layout = vi.hoisted(() => {
  const state: { isTight: boolean; width: number } = { isTight: false, width: 390 };
  return state;
});

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof UseBreakpoint>();
  return {
    ...actual,
    useBreakpoint: (): UseBreakpoint.Layout => ({
      ...actual.layoutFor({ width: layout.width, height: 844, fontScale: 1, topBarHeight: 0 }),
      isTight: layout.isTight,
    }),
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = ['empty', 'monthOnly', 'complete'] as const;

const ALL: Readonly<Record<StateName, AgeGateProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const IDS = { month: 'probe.birth-month', year: 'probe.birth-year' };
const MONTHS = STATES.empty.monthNames;
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

afterEach(() => {
  layout.isTight = false;
  layout.width = 390;
  vi.useRealTimers();
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one state of the fixtures and gives back its two controls. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
): { month: HTMLElement; year: HTMLElement } {
  cleanup();
  renderWithProviders(<AgeGate {...ALL[state]} />, options);
  return {
    month: screen.getByTestId(ALL[state].testIDs.month),
    year: screen.getByTestId(ALL[state].testIDs.year),
  };
}

type Answer = { month: number | null; year: number | null };

/** The gate held as the sign-up screen holds it; the caller's `onChange` hears every answer. */
function Held({
  start,
  onChange,
}: {
  start: Answer;
  onChange: (value: Answer) => void;
}): JSX.Element {
  const [answer, setAnswer] = useState(start);
  return (
    <AgeGate
      {...STATES.empty}
      month={answer.month}
      year={answer.year}
      testIDs={IDS}
      onChange={(next) => {
        onChange(next);
        setAnswer(next);
      }}
    />
  );
}

function draw(
  onChange: (value: Answer) => void,
  start: Answer = { month: null, year: null },
): void {
  cleanup();
  renderWithProviders(<Held start={start} onChange={onChange} />);
}

/** Lets a sheet or a list that was closed leave the page. */
function leave(): void {
  act(() => {
    vi.advanceTimersByTime(Math.max(motion.duration.sheet, motion.duration.fade) + 100);
  });
}

/** Everything the gate has drawn on the page, as text. */
function drawnText(): string {
  return document.body.textContent;
}

describe('AgeGate', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const { month, year } = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          // Each control shows its own answer, or its placeholder in the secondary color.
          const monthWords = within(month).getByText(
            fixture.month === null
              ? fixture.monthPlaceholder
              : (fixture.monthNames[fixture.month - 1] ?? ''),
          );
          expect(monthWords.style.color, name).toBe(
            written(fixture.month === null ? color[theme].textSecondary : color[theme].text),
          );
          const yearWords = within(year).getByText(
            fixture.year === null ? fixture.yearPlaceholder : String(fixture.year),
          );
          expect(yearWords.style.color, name).toBe(
            written(fixture.year === null ? color[theme].textSecondary : color[theme].text),
          );
          expect(screen.getByText(fixture.monthLabel), name).toBeDefined();
          expect(screen.getByText(fixture.yearLabel), name).toBeDefined();
          // Two controls and nothing else: no day, no box to tick, no line of help or of error.
          expect(screen.getAllByRole('combobox'), name).toEqual([month, year]);
          expect(screen.queryByRole('checkbox'), name).toBeNull();
          expect(screen.queryByRole('textbox'), name).toBeNull();
          expect(screen.queryByRole('alert'), name).toBeNull();
          expect(drawnText(), name).toBe(
            `${fixture.monthLabel}${monthWords.textContent}${fixture.yearLabel}${yearWords.textContent}`,
          );
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the three states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.empty.month).toBeNull();
    expect(STATES.empty.year).toBeNull();
    expect(STATES.monthOnly.month).toBe(3);
    expect(STATES.monthOnly.year).toBeNull();
    expect(STATES.complete.month).toBe(3);
    expect(STATES.complete.year).toBe(1990);
    // 2026 back 120 years, newest first.
    const { years } = STATES.empty;
    expect(years).toHaveLength(121);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(1906);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    expect(MONTHS).toHaveLength(12);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const { month, year } = drawState(state);
      const fixture = ALL[state];
      // Each select is named by its own label, which the caller wrote.
      expect(screen.getByRole('combobox', { name: fixture.monthLabel }), state).toBe(month);
      expect(screen.getByRole('combobox', { name: fixture.yearLabel }), state).toBe(year);
      // Nothing is announced about the answer.
      expect(
        document.querySelector('[aria-live], [role="alert"], [role="status"]'),
        state,
      ).toBeNull();
      expect(month.getAttribute('aria-describedby'), state).toBeNull();
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const { month, year } = drawState(state);
      for (const [control, id] of [
        [month, ALL[state].testIDs.month],
        [year, ALL[state].testIDs.year],
      ] as const) {
        expect(id, state).toMatch(TEST_ID);
        expect(control.getAttribute('data-testid'), state).toBe(id);
      }
      expect(ALL[state].testIDs.month, state).not.toBe(ALL[state].testIDs.year);
    }
    // The ids of the fixtures are each state's own.
    const ids = STATE_NAMES.flatMap((state) => Object.values(ALL[state].testIDs));
    expect(new Set(ids).size).toBe(6);
  });

  it('respects reduced motion', () => {
    for (const state of STATE_NAMES) {
      drawState(state, { reducedMotion: true });
      for (const part of document.body.querySelectorAll<HTMLElement>('*')) {
        expect(AT_REST, state).toContain(part.style.transform);
        expect(part.style.opacity, state).toBe('');
      }
    }
  });

  it('nothing preselected', () => {
    for (const width of [390, 1440]) {
      layout.width = width;
      const { month, year } = drawState('empty');
      const name = String(width);
      expect(within(month).getByText(STATES.empty.monthPlaceholder), name).toBeDefined();
      expect(within(year).getByText(STATES.empty.yearPlaceholder), name).toBeDefined();
      // Neither list draws an option as chosen.
      for (const which of ['month', 'year'] as const) {
        fireEvent.click(drawState('empty')[which]);
        const options = screen.queryAllByRole(width === 390 ? 'radio' : 'option');
        expect(options, `${name} ${which}`).toHaveLength(which === 'month' ? 12 : 121);
        for (const option of options) {
          expect(option.getAttribute('aria-checked') === 'true', name).toBe(false);
          expect(option.getAttribute('aria-selected') === 'true', name).toBe(false);
          expect(option.querySelector('svg'), name).toBeNull();
        }
      }
    }
    // Opening a list tells the caller nothing.
    const onChange = vi.fn();
    draw(onChange);
    fireEvent.click(screen.getByTestId(IDS.month));
    expect(screen.getByTestId(`${IDS.month}-popover`)).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('month and year reach the caller', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    draw(onChange);
    fireEvent.click(screen.getByTestId(IDS.month));
    fireEvent.click(screen.getByTestId(`${IDS.month}-options-3`));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ month: 3, year: null });
    leave();
    // The gate is drawn again with the month: the year is still not chosen.
    expect(within(screen.getByTestId(IDS.month)).getByText('March')).toBeDefined();
    expect(within(screen.getByTestId(IDS.year)).getByText('Year')).toBeDefined();
    fireEvent.click(screen.getByTestId(IDS.year));
    fireEvent.click(screen.getByTestId(`${IDS.year}-options-1990`));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ month: 3, year: 1990 });
    leave();
    expect(within(screen.getByTestId(IDS.year)).getByText('1990')).toBeDefined();
    // Both answers are numbers, and a change of one keeps the other.
    fireEvent.click(screen.getByTestId(IDS.month));
    fireEvent.click(screen.getByTestId(`${IDS.month}-options-12`));
    expect(onChange).toHaveBeenLastCalledWith({ month: 12, year: 1990 });
  });

  it('the year alone reaches the caller with no month', () => {
    layout.width = 1440;
    const onChange = vi.fn();
    draw(onChange);
    fireEvent.click(screen.getByTestId(IDS.year));
    fireEvent.click(screen.getByTestId(`${IDS.year}-2001`));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ month: null, year: 2001 });
  });

  it('twelve months', () => {
    layout.width = 1440;
    fireEvent.click(drawState('empty').month);
    const list = screen.getByRole('listbox', { name: STATES.empty.monthLabel });
    const options = within(list).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([...MONTHS]);
    expect(options.map((option) => option.getAttribute('data-testid'))).toEqual(
      MONTHS.map((_, index) => `${STATES.empty.testIDs.month}-${String(index + 1)}`),
    );
    // The years are the caller's, newest first, each under its own number.
    fireEvent.click(drawState('empty').year);
    const years = within(
      screen.getByRole('listbox', { name: STATES.empty.yearLabel }),
    ).getAllByRole('option');
    expect(years.map((option) => option.getAttribute('aria-label'))).toEqual(
      STATES.empty.years.map(String),
    );
    expect(years[0]?.getAttribute('data-testid')).toBe(`${STATES.empty.testIDs.year}-2026`);
  });

  it('the chosen month and year are the chosen options of their lists', () => {
    layout.width = 1440;
    fireEvent.click(drawState('complete').month);
    const march = screen.getByTestId(`${STATES.complete.testIDs.month}-3`);
    expect(march.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(march);
    fireEvent.click(drawState('complete').year);
    const year = screen.getByTestId(`${STATES.complete.testIDs.year}-1990`);
    expect(year.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(year);
  });

  it('side by side from the medium breakpoint, the month takes the wider share', () => {
    for (const width of [600, 820, 1440]) {
      layout.width = width;
      const name = String(width);
      const { month, year } = drawState('empty');
      const row = month.closest<HTMLElement>('[style*="flex-direction: row"][style*="gap"]');
      expect(row, name).not.toBeNull();
      expect(row?.style.columnGap, name).toBe('12px');
      expect(row?.contains(year), name).toBe(true);
      const [monthShare, yearShare] = [...(row?.children ?? [])];
      expect(monthShare?.contains(month), name).toBe(true);
      expect(yearShare?.contains(year), name).toBe(true);
      expect(monthShare instanceof HTMLElement ? monthShare.style.flexGrow : '', name).toBe('3');
      expect(yearShare instanceof HTMLElement ? yearShare.style.flexGrow : '', name).toBe('2');
    }
  });

  it('stacked on a phone at every text size', () => {
    // A share of a phone's width cuts a select's words short, so neither select is given one.
    for (const width of [320, 360, 390, 430, 599]) {
      for (const scale of [1, 1.3]) {
        layout.width = width;
        const name = `${String(width)} ${String(scale)}`;
        const { month, year } = drawState('empty', { textScale: scale });
        expect(
          month
            .closest<HTMLElement>('[style*="flex-direction: row"][style*="gap"]')
            ?.contains(year) ?? false,
          name,
        ).toBe(false);
        const stack = month.closest<HTMLElement>('[style*="gap"]');
        expect(stack?.contains(year), name).toBe(true);
        // A column, the month first, 12 apart, each select as wide as the column.
        expect(stack?.style.flexDirection, name).toBe('');
        expect(stack?.style.rowGap, name).toBe('12px');
        const [first, second] = [...(stack?.children ?? [])];
        expect(first?.contains(month), name).toBe(true);
        expect(second?.contains(year), name).toBe(true);
        for (const each of [first, second]) {
          expect(each instanceof HTMLElement ? each.style.flexGrow : null, name).toBe('');
        }
        // Both placeholders are drawn whole in the page; nothing else stands beside either.
        expect(within(month).getByText(STATES.empty.monthPlaceholder), name).toBeDefined();
        expect(within(year).getByText(STATES.empty.yearPlaceholder), name).toBeDefined();
      }
    }
  });

  it('stacked when tight', () => {
    layout.isTight = true;
    const { month, year } = drawState('empty');
    const stack = month.closest<HTMLElement>('[style*="gap"]');
    expect(stack).not.toBeNull();
    expect(stack?.contains(year)).toBe(true);
    // A column, the month first, 12 apart, each select as wide as the column.
    expect(stack?.style.flexDirection).toBe('');
    expect(stack?.style.rowGap).toBe('12px');
    const [first, second] = [...(stack?.children ?? [])];
    expect(first?.contains(month)).toBe(true);
    expect(second?.contains(year)).toBe(true);
    expect(month.compareDocumentPosition(year) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    for (const each of [first, second]) {
      expect(each instanceof HTMLElement ? each.style.flexGrow : null).toBe('');
    }
  });

  it('no answer is hinted', () => {
    // Words of the caller's that say nothing of the answer.
    const neutral: AgeGateProps = {
      ...STATES.empty,
      monthLabel: 'Month of birth',
      yearLabel: 'Year of birth',
      monthPlaceholder: 'Month',
      yearPlaceholder: 'Year',
    };
    const hints = ['adult', 'old', 'enough', 'over'];
    const check = (name: string): void => {
      const text = drawnText().toLocaleLowerCase();
      expect(text, name).not.toContain('18');
      for (const word of hints) {
        expect(text, `${name} ${word}`).not.toContain(word);
      }
    };
    for (const answer of [
      { month: null, year: null },
      { month: 3, year: null },
      { month: 3, year: 1990 },
      // Whichever side of the line the answer falls on, the gate draws the same and says nothing.
      { month: 11, year: 2020 },
    ]) {
      cleanup();
      renderWithProviders(<AgeGate {...neutral} {...answer} />);
      check(JSON.stringify(answer));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelectorAll('[aria-describedby]')).toHaveLength(0);
    }
    // The month list adds the caller's month names and nothing else.
    layout.width = 1440;
    cleanup();
    renderWithProviders(<AgeGate {...neutral} />);
    fireEvent.click(screen.getByTestId(neutral.testIDs.month));
    check('month list');
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([...MONTHS]);
    // The accessible names are the caller's words too.
    for (const element of document.querySelectorAll('[aria-label]')) {
      const name = (element.getAttribute('aria-label') ?? '').toLocaleLowerCase();
      for (const word of [...hints, '18']) {
        expect(name, word).not.toContain(word);
      }
    }
  });
});
