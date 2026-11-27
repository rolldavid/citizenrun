import { cleanup, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { Text } from '@/ui/components/text';
import { color, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { RightColumn } from './right-column';
import { GROUND, PREVIEW, STATES } from './right-column.fixtures';

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

const STATE_NAMES = ['twoModules', 'officeActionCard'] as const;

/** Words each state draws. */
const WORDS: Readonly<Record<(typeof STATE_NAMES)[number], readonly string[]>> = {
  twoModules: ['Deadlines near you', 'People in your races'],
  officeActionCard: ['Follow', '12', 'closes Fri, Nov 27'],
};

const CARD = 'gallery.right-column-office-action-card';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** Renders one element, in place of whatever was drawn before, and gives back what it drew. */
function draw(element: ReactElement, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  return renderWithProviders(element, options).container;
}

/** The column itself: the scrolling view the component draws. */
function columnOf(container: HTMLElement): HTMLElement {
  const column = container.querySelector<HTMLElement>('[style*="margin-left"]');
  if (column === null) {
    throw new Error('no column was drawn');
  }
  return column;
}

/** The view that holds the modules, inside the scrolling one. */
function modulesOf(container: HTMLElement): HTMLElement {
  const modules = columnOf(container).firstElementChild;
  if (!(modules instanceof HTMLElement)) {
    throw new Error('the column holds nothing');
  }
  return modules;
}

describe('RightColumn', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const container = draw(<RightColumn {...STATES[state]} />, { theme });
        expect(columnOf(container), state).toBeDefined();
        for (const words of WORDS[state]) {
          expect(screen.getAllByText(words).length, `${state} ${words}`).toBeGreaterThan(0);
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the two states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('holds the office action card', () => {
    for (const theme of ['light', 'dark'] as const) {
      const column = columnOf(draw(<RightColumn {...STATES.officeActionCard} />, { theme }));
      const actions = within(column).getByTestId(CARD);
      const card = actions.parentElement;
      if (card === null) {
        throw new Error('the column holds no card');
      }
      // One module, as wide as the action card and so as the column, its parts 16 apart.
      expect(modulesOf(column.parentElement ?? column).children).toHaveLength(1);
      expect(card.style.width).toBe(`${String(size.actionCard)}px`);
      expect(size.actionCard).toBe(size.rightColumn);
      expect(card.style.rowGap).toBe(`${String(space.x4)}px`);
      expect(card.children).toHaveLength(3);

      // The actions, stacked: Run does not exist yet, so Follow and Bookmark on one row.
      expect(card.children[0]).toBe(actions);
      expect(actions.children).toHaveLength(1);
      expect(within(actions).queryByTestId(`${CARD}-run`)).toBeNull();
      const follow = within(actions).getByTestId(`${CARD}-follow`);
      const bookmark = within(actions).getByTestId(`${CARD}-bookmark`);
      expect(follow.getAttribute('aria-label')).toBe('Follow');
      expect(bookmark.getAttribute('aria-label')).toBe('Bookmark');
      expect(follow.compareDocumentPosition(bookmark) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
        0,
      );

      // The day count as a numeral, with the date it counts to beside it at full contrast.
      const days = within(column).getByText('12');
      const closes = within(column).getByText('closes Fri, Nov 27');
      expect(card.children[1]?.contains(days)).toBe(true);
      expect(days.style.fontFamily).toBe(typography.numeralTitle.style.fontFamily);
      expect(closes.style.fontFamily).toBe(typography.caption.style.fontFamily);
      expect(closes.style.color).toBe(written(color[theme].text));
      expect(days.compareDocumentPosition(closes) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      const line = card.children[1];
      expect(line instanceof HTMLElement ? line.style.flexDirection : '').toBe('row');
      expect(line instanceof HTMLElement ? line.style.columnGap : '').toBe(`${String(space.x2)}px`);

      // The two meters, neither scored yet and neither opened.
      const meters = card.children[2];
      const ease = within(column).getByTestId(`${CARD}-ease`);
      const impact = within(column).getByTestId(`${CARD}-impact`);
      expect(meters?.contains(ease)).toBe(true);
      expect(meters?.contains(impact)).toBe(true);
      expect(ease.compareDocumentPosition(impact) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      expect(ease.textContent).toContain('Ease');
      expect(impact.textContent).toContain('Impact');
      expect(ease.textContent).toContain('not known yet');
      expect(impact.textContent).toContain('not known yet');
      expect(ease.getAttribute('aria-expanded')).not.toBe('true');
    }
  });

  it("is the right column's width", () => {
    const column = columnOf(draw(<RightColumn {...STATES.twoModules} />));
    expect(column.style.width).toBe(`${String(size.rightColumn)}px`);
    // The gap to the feed column is the column's own, and it never grows past its width.
    expect(column.style.marginLeft).toBe(`${String(size.columnGap)}px`);
    expect(column.style.flexGrow).toBe('0');
  });

  it('stacks its modules in order with the space between them', () => {
    const container = draw(
      <RightColumn>
        <Text role="body">First</Text>
        <Text role="body">Second</Text>
        <Text role="body">Third</Text>
      </RightColumn>,
    );
    const modules = modulesOf(container);
    expect([...modules.children].map((child) => child.textContent)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    expect(modules.style.rowGap).toBe(`${String(space.x6)}px`);
    expect(modules.style.paddingTop).toBe(`${String(space.x6)}px`);
  });

  it('scrolls by itself when it is taller than the window', () => {
    const column = columnOf(draw(<RightColumn {...STATES.twoModules} />));
    const drawn = window.getComputedStyle(column);
    expect(drawn.overflowY).toBe('auto');
    expect(drawn.overflowX).toBe('hidden');
  });

  it('draws no frame of its own around the modules', () => {
    for (const theme of ['light', 'dark'] as const) {
      const container = draw(<RightColumn {...STATES.twoModules} />, { theme });
      for (const part of [columnOf(container), modulesOf(container)]) {
        expect(part.style.backgroundColor, theme).toBe('');
        expect(part.style.borderWidth, theme).toBe('');
        expect(part.style.borderLeftWidth, theme).toBe('');
      }
    }
  });

  it('has a label and a role', () => {
    // The column is a plain container: it claims no role and no name, and a reader meets its
    // modules in the order they are given.
    const column = columnOf(draw(<RightColumn {...STATES.twoModules} />));
    expect(column.getAttribute('role')).toBeNull();
    expect(column.getAttribute('aria-label')).toBeNull();
    expect(column.getAttribute('aria-hidden')).toBeNull();
    expect(modulesOf(column.parentElement ?? column).getAttribute('role')).toBeNull();
    const labels = [...column.querySelectorAll('[dir="auto"]')].map((line) => line.textContent);
    expect(labels).toEqual([
      'Deadlines near you',
      'County Treasurer, Wren County. Filing closes in 12 days, on Fri, Nov 20.',
      'People in your races',
      'Carol Wynn holds the office. Dana Okafor is running.',
    ]);
  });

  it('has a testID', () => {
    // The column has no testID of its own: a screen finds a module by the module's id.
    const container = draw(
      <RightColumn>
        <View testID="probe.module" />
      </RightColumn>,
    );
    const ids = [...container.querySelectorAll('[data-testid]')].map((element) =>
      element.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['probe.module']);
    for (const id of ids) {
      expect(id).toMatch(TEST_ID);
    }
    expect(draw(<RightColumn {...STATES.twoModules} />).querySelector('[data-testid]')).toBeNull();
  });

  it('respects reduced motion', () => {
    // Nothing in the column moves, with reduced motion on or off.
    const drawn = [false, true].map((reducedMotion) => {
      const container = draw(<RightColumn {...STATES.twoModules} />, { reducedMotion });
      for (const part of [columnOf(container), ...columnOf(container).querySelectorAll('*')]) {
        if (part instanceof HTMLElement) {
          expect(part.style.transform).toBe('');
          expect(part.style.animationName).toBe('');
          expect(part.style.transitionProperty).toBe('');
        }
      }
      return columnOf(container).outerHTML;
    });
    expect(drawn[1]).toBe(drawn[0]);
  });
});
