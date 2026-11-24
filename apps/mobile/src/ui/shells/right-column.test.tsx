import { cleanup, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { Text } from '@/ui/components/text';
import { size, space } from '@/ui/tokens';

import { RightColumn } from './right-column';
import { GROUND, PREVIEW, STATES } from './right-column.fixtures';

const STATE_NAMES = ['twoModules'] as const;

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
        expect(screen.getByText('Deadlines near you'), state).toBeDefined();
        expect(screen.getByText('People in your races'), state).toBeDefined();
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the one state', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
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
      'County Treasurer, Wren County. Filing closes in 12 days.',
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
