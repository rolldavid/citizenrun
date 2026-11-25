import { BRAND } from '@citizenrun/shared';
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { SectionHeader } from './section-header';
import type { SectionHeaderProps } from './section-header';
import { GROUND, PREVIEW, STATES } from './section-header.fixtures';

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

const STATE_NAMES = ['plain', 'withCount', 'withAction', 'level3'] as const;

const ALL: Readonly<Record<StateName, SectionHeaderProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const EDIT = 'gallery.section-header-with-action-edit';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one header and returns its heading. */
function draw(props: SectionHeaderProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<SectionHeader {...props} />, options);
  return screen.getByRole('heading');
}

/** The line a header draws: the row that holds the label and what trails it. */
function lineOf(heading: HTMLElement): HTMLElement {
  const line = heading.parentElement?.parentElement;
  if (!line) {
    throw new Error('the header draws no line');
  }
  return line;
}

describe('SectionHeader', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const heading = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // The label: the mono label role, in capitals, at the text size in use.
          expect(heading.textContent, name).toBe(ALL[state].label);
          expect(heading.style.textTransform, name).toBe('uppercase');
          expect(parseFloat(heading.style.fontSize), name).toBeCloseTo(12 * scale);
          expect(heading.style.color, name).toBe(written(color[theme].text));
          // The rule above, then 12 points to the label and 8 under it.
          const line = lineOf(heading);
          expect(line.style.borderTopWidth, name).toBe('1px');
          expect(line.style.borderTopColor, name).toBe(written(color[theme].rule));
          expect(line.style.paddingTop, name).toBe('12px');
          expect(line.style.paddingBottom, name).toBe('8px');
          // The label at the left, and what trails it at the right of the same line.
          expect(line.style.flexDirection, name).toBe('row');
          expect(line.style.justifyContent, name).toBe('space-between');
          expect(line.childElementCount, name).toBe(ALL[state].trailing === undefined ? 1 : 2);
        }
      }
    }
    // What trails the label is drawn as given, after it.
    expect(lineOf(draw(STATES.withCount)).lastElementChild?.textContent).toBe('38');
    expect(lineOf(draw(STATES.withAction)).lastElementChild?.textContent).toBe('Edit');
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the four states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.level3.level).toBe(3);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const heading = draw(ALL[state]);
      const level = ALL[state].level ?? 2;
      expect(screen.getByRole('heading', { name: ALL[state].label, level }), state).toBe(heading);
      expect(screen.getAllByRole('heading'), state).toHaveLength(1);
    }
    // An action on the line keeps its own role and name.
    draw(STATES.withAction);
    expect(screen.getByRole('button', { name: 'Edit' })).toBe(screen.getByTestId(EDIT));
  });

  it('has a testID', () => {
    // A header is not interactive and carries no id; an action on its line carries its own.
    for (const state of STATE_NAMES) {
      draw(ALL[state]);
      const ids = [...document.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(state === 'withAction' ? [EDIT] : []);
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    // A header never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of ['plain', 'withCount', 'level3'] as const) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={{ pressed: true }}>
            <SectionHeader {...ALL[state]} />
          </InteractionPreview>,
          { reducedMotion },
        );
        for (const part of view.container.querySelectorAll<HTMLElement>('*')) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('a level 2 heading', () => {
    const heading = draw({ label: 'Your issues' });
    expect(heading.getAttribute('aria-level')).toBe('2');
    expect(draw({ label: 'Filing dates', level: 3 }).getAttribute('aria-level')).toBe('3');
    expect(draw({ label: 'Your issues', level: 2 }).getAttribute('aria-level')).toBe('2');
  });

  it('four words at most', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => draw({ label: 'Offices near you today' })).not.toThrow();
    expect(() => draw({ label: 'Every office open near you' })).toThrow(
      'A section label has four words at most',
    );
    // The product's name stands in the wordmark and nowhere in a label, however it is written.
    for (const label of [BRAND.displayName, `About ${BRAND.displayName.toLowerCase()}`]) {
      expect(() => draw({ label }), label).toThrow('A section label never holds the product name');
    }
    errors.mockRestore();
  });
});
