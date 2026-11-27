import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, size, space, z } from '@/ui/tokens';

import { Table } from './table';
import type { TableProps } from './table';
import { GROUND, PREVIEW, STATES } from './table.fixtures';
import { Text } from './text';

type StateName = keyof typeof STATES;

const STATE_NAMES = ['results', 'unknown', 'about', 'empty', 'wide', 'pressable'] as const;

const ALL: Readonly<Record<StateName, TableProps>> = STATES;

const COMPACT = [360, 740] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const CAPTION = 'Past results for Fixture Wren County Treasurer';
const UNKNOWN = 'not known yet';
const ROW_IDS = ['2023-general', '2019-general', '2015-general'] as const;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one table, in place of whatever was drawn before, and gives back its box. */
function draw(props: TableProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<Table {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** The line of a row: the element that carries the rule under it. */
function lineOf(row: HTMLElement): HTMLElement {
  const line = [row, ...row.querySelectorAll<HTMLElement>('*')].find(
    (part) => part.style.borderBottomWidth === `${String(rule.hairline)}px`,
  );
  if (line === undefined) {
    throw new Error('the row draws no rule');
  }
  return line;
}

/** The focus bars drawn in a table: every drawing of the bar's width at the left edge. */
function barsOf(table: HTMLElement): HTMLElement[] {
  return [...table.querySelectorAll<HTMLElement>('*')].filter(
    (part) =>
      part.style.position === 'absolute' &&
      part.style.left === '0px' &&
      part.style.width === `${String(rule.active)}px`,
  );
}

function focus(element: HTMLElement): void {
  act(() => {
    element.focus();
  });
}

describe('Table', () => {
  it('renders every state', () => {
    setViewport(...COMPACT);
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const table = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const rows = within(table).getAllByRole('row');
          expect(rows, name).toHaveLength(ALL[state].rows.length + 1);
          // The column heads: mono capitals over a rule of the text's own weight.
          const heads = within(table).getAllByRole('columnheader');
          expect(
            heads.map((head) => head.textContent),
            name,
          ).toEqual(ALL[state].columns.map((column) => column.header));
          for (const head of heads) {
            const words = head.querySelector<HTMLElement>('[dir]');
            expect(words?.style.textTransform, name).toBe('uppercase');
            expect(words?.style.fontFamily, name).toContain('ChivoMono');
            expect(head.style.paddingLeft, name).toBe(`${String(space.x2)}px`);
          }
          const [head, ...body] = rows;
          const headLine = lineOf(head as HTMLElement);
          expect(headLine.style.borderBottomColor, name).toBe(written(color[theme].rule));
          expect(headLine.style.minHeight, name).toBe(`${String(size.listRowCompact)}px`);
          // Every row of values stands on a soft rule, at least as high as a compact list row.
          for (const row of body) {
            const line = lineOf(row);
            expect(line.style.borderBottomColor, name).toBe(written(color[theme].ruleSoft));
            expect(line.style.minHeight, name).toBe(`${String(size.listRowCompact)}px`);
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.table-${kebab(state)}`);
      expect(ALL[state].caption, state).toBe(CAPTION);
    }
    expect(STATES.results.rows.map((row) => row.id)).toEqual([...ROW_IDS]);
    expect(STATES.results.rows[0].href).toBe('/dev/gallery');
    expect(STATES.empty.rows).toHaveLength(0);
    expect(STATES.wide.columns).toHaveLength(6);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const table = draw(ALL[state]);
      expect(screen.getByRole('table', { name: CAPTION }), state).toBe(table);
      // A row that opens something is named by its first cell.
      for (const row of ALL[state].rows) {
        if (row.onPress === undefined && row.href === undefined) {
          continue;
        }
        const target = within(table).getByTestId(`${ALL[state].testID}-${row.id}`);
        expect(target.getAttribute('role'), state).toBe(row.href === undefined ? 'button' : 'link');
        expect(target.getAttribute('aria-label'), state).toBe(
          row.id === '2023-general'
            ? '2023 general'
            : row.id === '2019-general'
              ? '2019 general'
              : '2015 general',
        );
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const table = draw(ALL[state]);
      expect(table.getAttribute('data-testid'), state).toMatch(TEST_ID);
      for (const target of table.querySelectorAll('a, [role="button"], [role="link"]')) {
        expect(target.getAttribute('data-testid'), state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    // A row cuts to its fill and never moves; the first column moves only with the scroll.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const table = draw(ALL[state], { reducedMotion });
        for (const target of table.querySelectorAll<HTMLElement>(
          '[role="button"], [role="link"]',
        )) {
          fireEvent.keyDown(target, { key: 'Enter' });
        }
        for (const part of [table, ...table.querySelectorAll<HTMLElement>('*')]) {
          expect(['', 'translateX(0px)'], state).toContain(part.style.transform);
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('shows not known yet', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      const table = draw(STATES.unknown, { theme });
      const row = within(table).getByTestId('gallery.table-unknown-2023-general');
      const words = within(row).getByText(UNKNOWN);
      // The unknown tag, at full contrast, in the cell of the value nobody knows.
      expect(words.parentElement?.style.borderStyle).toBe('dashed');
      expect(words.style.color).toBe(written(color[theme].text));
      expect(within(row).getAllByRole('cell')[2]?.contains(words)).toBe(true);
      expect(within(table).getAllByText(UNKNOWN)).toHaveLength(1);
      for (const part of table.querySelectorAll<HTMLElement>('*')) {
        expect(part.style.opacity).toBe('');
      }
    }
    // An estimate says so.
    const about = draw(STATES.about);
    expect(within(about).getByText('about 2,100')).toBeTruthy();
  });

  it('roles and caption', () => {
    setViewport(...COMPACT);
    const table = draw(STATES.results);
    expect(screen.getByRole('table', { name: CAPTION })).toBe(table);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    // The head is a row of column heads; the rows of values stand in one group.
    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader')).toHaveLength(4);
    const group = within(table).getByRole('rowgroup');
    expect(rows.slice(1).every((row) => row.parentElement === group)).toBe(true);
    // A row that opens nothing has one cell for each column.
    for (const row of rows.slice(2)) {
      expect(within(row).getAllByRole('cell')).toHaveLength(4);
      expect(row.getAttribute('tabindex')).toBeNull();
    }
    // A row that opens something is one target in one cell as wide as the table.
    const cells = within(rows[1] as HTMLElement).getAllByRole('cell');
    expect(cells).toHaveLength(1);
    expect(cells[0]?.getAttribute('aria-colspan')).toBe('4');
    const link = within(cells[0] as HTMLElement).getByRole('link', { name: '2023 general' });
    expect(link.getAttribute('href')).toBe('/dev/gallery');
    expect(link.textContent).toBe('2023 generalCarol Wynn612,100');
    expect(within(link).queryAllByRole('cell')).toHaveLength(0);
    // The caption is a name, not drawn words.
    expect(table.textContent).not.toContain(CAPTION);
  });

  it('numbers right-aligned and tabular', () => {
    setViewport(...COMPACT);
    const table = draw(STATES.results);
    const heads = within(table).getAllByRole('columnheader');
    expect(heads.map((head) => head.style.alignItems)).toEqual([
      'flex-start',
      'flex-start',
      'flex-end',
      'flex-end',
    ]);
    for (const number of ['61', '412', '38', '2,100', '1,874', '1,650']) {
      const words = within(table).getByText(number);
      expect(words.style.textAlign, number).toBe('right');
      expect(words.style.fontVariantNumeric, number).toBe('tabular-nums');
      expect(words.parentElement?.style.alignItems, number).toBe('flex-end');
    }
    for (const words of ['2019 general', 'Luis Marrero']) {
      const drawn = within(table).getByText(words);
      expect(drawn.style.textAlign, words).toBe('left');
      expect(drawn.style.fontVariantNumeric, words).toBe('');
      expect(drawn.parentElement?.style.alignItems, words).toBe('flex-start');
    }
    // A column that is only end-aligned keeps its own digits.
    const aligned = draw({
      ...STATES.results,
      columns: [
        { id: 'year', header: 'Year' },
        { id: 'winner', header: 'Winner', align: 'end' },
      ],
    });
    const winner = within(aligned).getByText('Luis Marrero');
    expect(winner.style.textAlign).toBe('right');
    expect(winner.style.fontVariantNumeric).toBe('');
  });

  it('unknown and about cells', () => {
    setViewport(...COMPACT);
    const unknown = draw(STATES.unknown);
    const first = within(unknown).getByTestId('gallery.table-unknown-2023-general');
    expect(within(first).getAllByRole('cell')[2]?.textContent).toBe(UNKNOWN);
    // The other row's margin is known and is drawn as it is.
    const second = within(unknown).getByTestId('gallery.table-unknown-2019-general');
    expect(within(second).getAllByRole('cell')[2]?.textContent).toBe('412');
    const about = draw(STATES.about);
    const estimated = within(about).getByTestId('gallery.table-about-2023-general');
    expect(within(estimated).getAllByRole('cell')[3]?.textContent).toBe('about 2,100');
    expect(within(about).getByText('about 2,100').style.opacity).toBe('');
    // A cell the row does not give is a value nobody knows, and never a blank.
    const missing = draw({
      ...STATES.results,
      rows: [{ id: '2023-general', cells: { year: { text: '2023 general', about: false } } }],
    });
    expect(within(missing).getAllByText(UNKNOWN)).toHaveLength(3);
    // An element is drawn as given.
    const element = draw({
      ...STATES.results,
      rows: [
        {
          id: '2023-general',
          cells: {
            ...STATES.results.rows[0].cells,
            winner: <Text role="bodyStrong">Dana Okafor</Text>,
          },
        },
      ],
    });
    expect(within(element).getByText('Dana Okafor')).toBeTruthy();
  });

  it('arrow keys move row focus', () => {
    setViewport(...COMPACT);
    const onPress = vi.fn<(id: string) => void>();
    const table = draw({
      ...STATES.pressable,
      rows: STATES.pressable.rows.map((row) => ({
        ...row,
        onPress: () => {
          onPress(row.id);
        },
      })),
    });
    const [first, second, third] = ROW_IDS.map((id) =>
      within(table).getByTestId(`gallery.table-pressable-${id}`),
    ) as [HTMLElement, HTMLElement, HTMLElement];
    focus(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);
    // At the last row the focus stays.
    fireEvent.keyDown(third, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
    // The key moves the focus, not the page; with a modifier it is left alone.
    expect(fireEvent.keyDown(first, { key: 'ArrowDown' })).toBe(false);
    focus(first);
    expect(fireEvent.keyDown(first, { key: 'ArrowDown', metaKey: true })).toBe(true);
    expect(document.activeElement).toBe(first);
    // Enter opens the row with focus.
    focus(second);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.keyDown(second, { key: 'Enter' });
    fireEvent.keyUp(second, { key: 'Enter' });
    fireEvent.click(second);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith('2019-general');
  });

  it('arrow keys pass the rows that open nothing', () => {
    setViewport(...COMPACT);
    const table = draw({
      ...STATES.pressable,
      rows: [
        STATES.pressable.rows[0],
        { id: '2019-general', cells: STATES.pressable.rows[1].cells },
        STATES.pressable.rows[2],
      ],
    });
    const first = within(table).getByTestId('gallery.table-pressable-2023-general');
    const third = within(table).getByTestId('gallery.table-pressable-2015-general');
    focus(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('the focused row shows its bar', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      const table = draw(STATES.pressable, { theme });
      expect(barsOf(table)).toHaveLength(0);
      const second = within(table).getByTestId('gallery.table-pressable-2019-general');
      focus(second);
      const bars = barsOf(table);
      expect(bars).toHaveLength(1);
      const bar = bars[0] as HTMLElement;
      // 4 points wide, in the text color, down the whole row, at its left edge.
      expect(second.contains(bar)).toBe(true);
      expect(bar.style.backgroundColor).toBe(written(color[theme].text));
      expect(bar.style.top).toBe('0px');
      expect(bar.style.bottom).toBe('0px');
      // The focused row stands over its neighbours.
      expect(second.closest<HTMLElement>('[role="row"]')?.style.zIndex).toBe(String(z.sticky));
      // The bar goes with the focus.
      const third = within(table).getByTestId('gallery.table-pressable-2015-general');
      fireEvent.keyDown(second, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(third);
      const moved = barsOf(table);
      expect(moved).toHaveLength(1);
      expect(third.contains(moved[0] as HTMLElement)).toBe(true);
      expect(second.closest<HTMLElement>('[role="row"]')?.style.zIndex).toBe('');
      act(() => {
        third.blur();
      });
      expect(barsOf(table)).toHaveLength(0);
    }
  });

  it('empty', () => {
    setViewport(...COMPACT);
    const table = draw(STATES.empty);
    // The head stays, with no row of values and no group for them.
    expect(within(table).getAllByRole('row')).toHaveLength(1);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).queryAllByRole('rowgroup')).toHaveLength(0);
    const words = within(table).getByText('No past results loaded yet.');
    const head = within(table).getAllByRole('row')[0] as HTMLElement;
    expect(head.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // With rows the element is not drawn; with neither, the head stands alone.
    const filled = draw({ ...STATES.results, empty: STATES.empty.empty });
    expect(within(filled).queryByText('No past results loaded yet.')).toBeNull();
    const bare = draw({
      columns: STATES.empty.columns,
      rows: [],
      caption: CAPTION,
      testID: STATES.empty.testID,
    });
    expect(bare.textContent).toBe('YearWinnerMarginVotes cast');
  });

  it('every row carries its test id', () => {
    setViewport(...COMPACT);
    const results = draw(STATES.results);
    for (const id of ROW_IDS) {
      const target = within(results).getByTestId(`gallery.table-results-${id}`);
      // On the link of the row that opens its election, and on the row's own view otherwise.
      expect(target.getAttribute('role'), id).toBe(id === '2023-general' ? 'link' : 'row');
    }
    const pressable = draw(STATES.pressable);
    for (const id of ROW_IDS) {
      const target = within(pressable).getByTestId(`gallery.table-pressable-${id}`);
      expect(target.getAttribute('role'), id).toBe('button');
    }
    for (const state of STATE_NAMES) {
      const table = draw(ALL[state]);
      const ids = [...table.querySelectorAll('[data-testid]')].map((part) =>
        part.getAttribute('data-testid'),
      );
      // The row's id follows the table's, with nothing between them.
      expect(ids, state).toEqual(ALL[state].rows.map((row) => `${ALL[state].testID}-${row.id}`));
      expect(
        ids.some((id) => id?.includes('-row-')),
        state,
      ).toBe(false);
    }
  });

  it('the first column is held', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      const table = draw(STATES.wide, { theme });
      const rows = within(table).getAllByRole('row');
      for (const row of rows) {
        const [first, ...others] = [
          ...row.querySelectorAll<HTMLElement>('[role="columnheader"], [role="cell"]'),
        ];
        // The first cell moves with the sideways offset, over the others, on an opaque ground.
        expect(first?.style.transform).toBe('translateX(0px)');
        expect(first?.style.backgroundColor).toBe(written(color[theme].bg));
        expect(first?.style.zIndex).toBe(String(z.sticky));
        for (const other of others) {
          expect(other.style.transform).toBe('');
          expect(other.style.backgroundColor).toBe('');
        }
      }
    }
    // In a row that is one target, the first of its drawn cells is the one that is held.
    const pressable = draw(STATES.pressable);
    const target = within(pressable).getByTestId('gallery.table-pressable-2019-general');
    const held = [...target.querySelectorAll<HTMLElement>('*')].filter(
      (part) => part.style.transform === 'translateX(0px)',
    );
    expect(held).toHaveLength(1);
    expect(held[0]?.textContent).toBe('2019 general');
    expect(held[0]?.style.backgroundColor).toBe(written(color.light.bg));
    // The rows are as wide as the table's box at least, inside a scroller that goes sideways.
    const scroller = pressable.firstElementChild as HTMLElement;
    expect(window.getComputedStyle(scroller).overflowX).toBe('auto');
  });
});
