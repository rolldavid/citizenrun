import { cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import type * as BreakpointModule from '@/ui/shells/use-breakpoint';
import { ISSUE_IDS } from '@/ui/tokens';

import { IssueGrid } from './issue-grid';
import type { IssueGridProps } from './issue-grid';
import { GROUND, PREVIEW, STATES } from './issue-grid.fixtures';
import { InteractionPreview } from './pressable';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A chip loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a chip loads no asset');
  },
}));

// The window the grid is laid out in: a phone, narrower or tight only where a case says so.
const layout = vi.hoisted(() => ({ isTight: false, width: 390 }));

vi.mock('@/ui/shells/use-breakpoint', async (importOriginal) => {
  const actual = await importOriginal<typeof BreakpointModule>();
  return {
    ...actual,
    useBreakpoint: (): BreakpointModule.Layout => ({
      ...actual.layoutFor({ width: layout.width, height: 844, fontScale: 1, topBarHeight: 0 }),
      isTight: layout.isTight,
    }),
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = ['none', 'three', 'ten'] as const;

const ALL: Readonly<Record<StateName, IssueGridProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.issue-grid';

/** Renders one grid and returns its group. */
function draw(props: IssueGridProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<IssueGrid {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** Renders the `ten` fixture under the probe id with the handlers given. */
function drawTen(given: Partial<IssueGridProps> = {}): HTMLElement {
  return draw({ ...STATES.ten, testID: PROBE, ...given });
}

/** The ids of the chips, in the order the page holds them. */
function chipOrder(grid: HTMLElement, testID: string): string[] {
  return [...grid.querySelectorAll('[role="checkbox"]')]
    .map((chip) => chip.getAttribute('data-testid') ?? '')
    .filter((id) => !id.endsWith('-star'))
    .map((id) => id.slice(testID.length + 1));
}

/** The rows of a grid: the views that lay their chips out side by side. */
function rowsOf(grid: HTMLElement): HTMLElement[] {
  return [...grid.children] as HTMLElement[];
}

describe('IssueGrid', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const grid = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          // All 19 issues, every one a checkbox that says whether it is picked.
          const chips = fixture.issues.map((issue) =>
            screen.getByTestId(`${fixture.testID}-${issue.id}`),
          );
          expect(chips, name).toHaveLength(19);
          for (const [index, chip] of chips.entries()) {
            const id = fixture.issues[index]?.id ?? '';
            expect(chip.getAttribute('aria-checked'), `${name} ${id}`).toBe(
              String(fixture.selectedIds.includes(id)),
            );
          }
          // A star on each picked chip and on no other, ticked where the issue is starred.
          const stars = [...grid.querySelectorAll('[data-testid$="-star"]')];
          expect(
            stars.map((star) => star.getAttribute('data-testid')),
            name,
          ).toEqual(
            fixture.issues
              .filter((issue) => fixture.selectedIds.includes(issue.id))
              .map((issue) => `${fixture.testID}-${issue.id}-star`),
          );
          for (const star of stars) {
            const id = (star.getAttribute('data-testid') ?? '').slice(
              fixture.testID.length + 1,
              -'-star'.length,
            );
            expect(star.getAttribute('aria-checked'), `${name} ${id}`).toBe(
              String(fixture.starredIds.includes(id)),
            );
          }
          // 4 points between rows and 8 between the two chips of a row.
          expect(grid.style.rowGap, name).toBe('4px');
          for (const row of rowsOf(grid)) {
            expect(row.style.flexDirection, name).toBe('row');
            expect(row.style.columnGap, name).toBe('8px');
          }
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
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.issue-grid-${state}`);
      // The 19 issues of the product, in their order, each with a short name.
      expect(
        ALL[state].issues.map((issue) => issue.id),
        state,
      ).toEqual([...ISSUE_IDS]);
      expect(ALL[state].maxSelected, state).toBe(10);
      expect(ALL[state].maxStarred, state).toBe(3);
      // A star is only ever on a picked issue.
      for (const id of ALL[state].starredIds) {
        expect(ALL[state].selectedIds, `${state} ${id}`).toContain(id);
      }
    }
    expect(STATES.none.selectedIds).toHaveLength(0);
    expect(STATES.three.selectedIds).toHaveLength(3);
    expect(STATES.three.starredIds).toHaveLength(1);
    expect(STATES.ten.selectedIds).toHaveLength(10);
    expect(STATES.ten.starredIds).toHaveLength(3);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const grid = draw(ALL[state]);
      const fixture = ALL[state];
      expect(screen.getByRole('group', { name: 'What do you want to change?' }), state).toBe(grid);
      // A chip is read by its full name where the grid has one, and prints the short one.
      for (const issue of fixture.issues) {
        const chip = screen.getByTestId(`${fixture.testID}-${issue.id}`);
        expect(chip.getAttribute('role'), issue.id).toBe('checkbox');
        expect(chip.getAttribute('aria-label'), issue.id).toBe(issue.label ?? issue.name);
        expect(screen.getByText(issue.name), issue.id).toBeTruthy();
      }
      // A star is named for its issue, from the catalog.
      for (const id of fixture.selectedIds) {
        const issue = fixture.issues.find((entry) => entry.id === id);
        expect(
          screen.getByTestId(`${fixture.testID}-${id}-star`).getAttribute('aria-label'),
          id,
        ).toBe(`Star ${issue?.name ?? ''}`);
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const grid = draw(ALL[state]);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(grid.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // Everything a person can press carries an id.
      const targets = grid.querySelectorAll('[role="checkbox"], a, button');
      expect(targets.length, state).toBe(19 + ALL[state].selectedIds.length);
      for (const element of targets) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    // Picking an issue cuts: nothing in the grid moves or fades under reduced motion.
    for (const state of STATE_NAMES) {
      cleanup();
      const view = renderWithProviders(
        <InteractionPreview state={{ pressed: true }}>
          <IssueGrid {...ALL[state]} />
        </InteractionPreview>,
        { reducedMotion: true },
      );
      for (const part of view.container.querySelectorAll<HTMLElement>('*')) {
        expect(['', 'translateY(0px) scale(1)'], state).toContain(part.style.transform);
        expect(part.style.transition, state).toBe('');
      }
    }
  });

  it('ids and order', () => {
    const order = STATES.none.issues.map((issue) => issue.id);
    for (const state of STATE_NAMES) {
      const grid = draw(ALL[state]);
      // The targets carry the grid's id and their issue's, in the order of `issues`.
      expect(chipOrder(grid, ALL[state].testID), state).toEqual(order);
    }
    // The order is the caller's, whatever it is.
    const reversed = [...STATES.none.issues].reverse();
    const grid = draw({ ...STATES.three, issues: reversed, testID: PROBE });
    expect(chipOrder(grid, PROBE)).toEqual(reversed.map((issue) => issue.id));
  });

  it('a press on a chip asks to pick it, and a press on its star asks to star it', () => {
    const onToggle = vi.fn();
    const onToggleStar = vi.fn();
    const onLimit = vi.fn();
    draw({ ...STATES.three, onToggle, onToggleStar, onLimit, testID: PROBE });
    fireEvent.click(screen.getByTestId(`${PROBE}-climate`));
    expect(onToggle).toHaveBeenLastCalledWith('climate');
    fireEvent.click(screen.getByTestId(`${PROBE}-rent-housing`));
    expect(onToggle).toHaveBeenLastCalledWith('rent-housing');
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggleStar).not.toHaveBeenCalled();
    // A star never picks or unpicks its chip.
    fireEvent.click(screen.getByTestId(`${PROBE}-utility-bills-star`));
    expect(onToggleStar).toHaveBeenLastCalledWith('utility-bills');
    fireEvent.click(screen.getByTestId(`${PROBE}-rent-housing-star`));
    expect(onToggleStar).toHaveBeenLastCalledWith('rent-housing');
    expect(onToggleStar).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onLimit).not.toHaveBeenCalled();
    // A chip that is not picked shows no star.
    expect(screen.queryByTestId(`${PROBE}-climate-star`)).toBeNull();
  });

  it('the eleventh issue', () => {
    const onToggle = vi.fn();
    const onLimit = vi.fn();
    drawTen({ onToggle, onLimit });
    expect(STATES.ten.selectedIds).not.toContain('schools');
    fireEvent.click(screen.getByTestId(`${PROBE}-schools`));
    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(onLimit).toHaveBeenLastCalledWith('selected');
    expect(onToggle).not.toHaveBeenCalled();
    // Nothing changed on the page.
    expect(screen.getByTestId(`${PROBE}-schools`).getAttribute('aria-checked')).toBe('false');
    // One under the limit, the same press picks.
    drawTen({ onToggle, onLimit, selectedIds: STATES.ten.selectedIds.slice(0, 9), starredIds: [] });
    fireEvent.click(screen.getByTestId(`${PROBE}-schools`));
    expect(onToggle).toHaveBeenLastCalledWith('schools');
    expect(onLimit).toHaveBeenCalledTimes(1);
  });

  it('the fourth star', () => {
    const onToggleStar = vi.fn();
    const onToggle = vi.fn();
    const onLimit = vi.fn();
    drawTen({ onToggleStar, onToggle, onLimit });
    expect(STATES.ten.starredIds).not.toContain('utility-bills');
    fireEvent.click(screen.getByTestId(`${PROBE}-utility-bills-star`));
    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(onLimit).toHaveBeenLastCalledWith('starred');
    expect(onToggleStar).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
    // A star that is on can always be taken off.
    fireEvent.click(screen.getByTestId(`${PROBE}-rent-housing-star`));
    expect(onToggleStar).toHaveBeenLastCalledWith('rent-housing');
    expect(onLimit).toHaveBeenCalledTimes(1);
    // One under the limit, the same press stars.
    drawTen({ onToggleStar, onLimit, starredIds: STATES.ten.starredIds.slice(0, 2) });
    fireEvent.click(screen.getByTestId(`${PROBE}-utility-bills-star`));
    expect(onToggleStar).toHaveBeenLastCalledWith('utility-bills');
    expect(onLimit).toHaveBeenCalledTimes(1);
  });

  it('unselect at the limit', () => {
    const onToggle = vi.fn();
    const onLimit = vi.fn();
    drawTen({ onToggle, onLimit });
    for (const id of STATES.ten.selectedIds) {
      fireEvent.click(screen.getByTestId(`${PROBE}-${id}`));
      expect(onToggle).toHaveBeenLastCalledWith(id);
    }
    expect(onToggle).toHaveBeenCalledTimes(10);
    expect(onLimit).not.toHaveBeenCalled();
  });

  it('two columns, one when tight', () => {
    const grid = draw(STATES.none);
    // Ten rows: nine of two chips, and the last issue beside an empty cell that keeps its column.
    const rows = rowsOf(grid);
    expect(rows).toHaveLength(10);
    for (const [index, row] of rows.entries()) {
      expect(row.childElementCount, String(index)).toBe(2);
      expect(row.querySelectorAll('[role="checkbox"]'), String(index)).toHaveLength(
        index === 9 ? 1 : 2,
      );
      for (const cell of [...row.children] as HTMLElement[]) {
        // Two equal columns: each cell takes a half, however long its name.
        expect(cell.style.flexGrow, String(index)).toBe('1');
        expect(cell.style.flexBasis, String(index)).toBe('0%');
        expect(cell.style.minWidth, String(index)).toBe('0px');
      }
    }
    expect(rows[9]?.lastElementChild?.childElementCount).toBe(0);
    // A chip fills its cell, so the two chips of a row are one height: the cell is a row, the
    // chip grows along it and is as high as it by stretching.
    const chip = screen.getByTestId('gallery.issue-grid-none-rent-housing');
    const filled = chip.parentElement?.parentElement;
    expect(filled?.style.flexGrow).toBe('1');
    expect(filled?.parentElement?.style.flexDirection).toBe('row');
    expect(filled?.parentElement?.parentElement).toBe(rows[0]);

    layout.isTight = true;
    try {
      const tight = draw(STATES.none);
      const single = rowsOf(tight);
      expect(single).toHaveLength(19);
      for (const row of single) {
        expect(row.childElementCount).toBe(1);
        expect(row.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
      }
      // The same issues in the same order.
      expect(chipOrder(tight, STATES.none.testID)).toEqual([...ISSUE_IDS]);
    } finally {
      layout.isTight = false;
    }
  });

  it('one column under a development text size on a narrow window', () => {
    // A browser's font scale is 1, so a review of large text there sets the theme's text size.
    const perRow = (grid: HTMLElement): number[] => [
      ...new Set(rowsOf(grid).map((row) => row.querySelectorAll('[role="checkbox"]').length)),
    ];
    layout.width = 360;
    try {
      expect(perRow(draw(STATES.none, { textScale: 1.3 }))).toEqual([1]);
      expect(perRow(draw(STATES.none, { textScale: 1.15 }))).toEqual([1]);
      expect(chipOrder(draw(STATES.none, { textScale: 1.3 }), STATES.none.testID)).toEqual([
        ...ISSUE_IDS,
      ]);
      // Under the size a tight layout starts at, and at the default size, two columns.
      expect(perRow(draw(STATES.none, { textScale: 1.14 }))).toEqual([2, 1]);
      expect(perRow(draw(STATES.none))).toEqual([2, 1]);
    } finally {
      layout.width = 390;
    }
    // A window that is not narrow keeps two columns at any text size.
    expect(perRow(draw(STATES.none, { textScale: 1.3 }))).toEqual([2, 1]);
  });

  it('group name', () => {
    const grid = draw(STATES.three);
    expect(grid.getAttribute('role')).toBe('group');
    expect(grid.getAttribute('aria-label')).toBe('What do you want to change?');
    expect(screen.getByRole('group', { name: 'What do you want to change?' })).toBe(grid);
    // Without a label the group has no name of its own.
    const { label: _label, ...unnamed } = STATES.three;
    const plain = draw({ ...unnamed, testID: PROBE });
    expect(plain.getAttribute('role')).toBe('group');
    expect(plain.getAttribute('aria-label')).toBeNull();
  });
});
