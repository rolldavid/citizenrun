import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';
import type { TypeRole } from '@/ui/typography';

import { DeadlineLine } from './deadline-line';
import type { DeadlineLineProps } from './deadline-line';
import { GROUND, PREVIEW, STATES } from './deadline-line.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'card',
  'cardAt',
  'cardUnknown',
  'row',
  'rowAt',
  'rowFlag',
  'rowNone',
] as const;

const ALL: Readonly<Record<StateName, DeadlineLineProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one line, in place of whatever was drawn before, and gives back the element with its id. */
function draw(props: DeadlineLineProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<DeadlineLine {...props} />, options);
  if (props.testID === undefined) {
    throw new Error('every fixture line has a testID');
  }
  return screen.getByTestId(props.testID);
}

/** Expects `words` to be set in `role` at `scale`. */
function expectRole(words: HTMLElement, role: TypeRole, scale: number, name: string): void {
  const style = typography[role].style;
  expect(words.style.fontFamily, name).toContain(String(style.fontFamily));
  expect(parseFloat(words.style.fontSize), name).toBeCloseTo((style.fontSize ?? 0) * scale);
}

describe('DeadlineLine', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const line = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const words = screen.getByText(props.text);
          // The date is native text that grows with the text size, in the text color.
          expectRole(words, props.variant === 'card' ? 'label' : 'caption', scale, name);
          expect(words.style.color, name).toBe(written(color[theme].text));
          expect(line.textContent, name).toBe(`${props.flagLabel ?? ''}${props.text}`);
          // Never mono.
          expect(words.style.fontFamily, name).not.toContain('Mono');
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.deadline-line-${kebab(state)}`);
    }
    expect(STATES.card.text).toBe('Filing closes Fri, Nov 27. Confirm with your election office.');
    expect(STATES.row.text).toBe('closes Fri, Nov 27');
    expect(STATES.rowAt.text).toBe('closes Fri, Nov 27 at 5:00 pm Pacific');
    expect(STATES.rowFlag.flagLabel).toBe('5 days to file');
    expect(STATES.rowFlag.text).toBe('closes Fri, Nov 20');
    expect(STATES.rowNone.text).toBe('no election scheduled yet');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const line = draw(ALL[state]);
      // Read as plain text: no role, no name of its own, nothing hidden, nothing to press.
      for (const part of [line, ...line.querySelectorAll<HTMLElement>('*')]) {
        expect(part.getAttribute('role'), state).toBeNull();
        expect(part.getAttribute('aria-label'), state).toBeNull();
        expect(part.getAttribute('aria-hidden'), state).toBeNull();
        expect(part.getAttribute('tabindex'), state).toBeNull();
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const line = draw(ALL[state]);
      expect(line.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(1);
    }
    // The id is the caller's to give: a line without one draws none.
    cleanup();
    renderWithProviders(<DeadlineLine variant="row" text="closes Fri, Nov 27" />);
    expect(document.querySelectorAll('[data-testid]')).toHaveLength(0);
    expect(screen.getByText('closes Fri, Nov 27')).toBeDefined();
  });

  it('respects reduced motion', () => {
    // The line never moves, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const line = draw(ALL[state], { reducedMotion });
        for (const part of [line, ...line.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }
  });

  it('shows not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      const line = draw(STATES.cardUnknown, { theme });
      // The words say it, at full contrast: never grey, never a dash, never a blank.
      expect(line.textContent).toBe(
        'Filing deadline not known yet. Confirm with your election office.',
      );
      expect(line.style.color).toBe(written(color[theme].text));
      expect(line.style.color).not.toBe(written(color[theme].textSecondary));
      expect(line.style.opacity).toBe('');
    }
  });

  it('card line in label and text color', () => {
    for (const theme of ['light', 'dark'] as const) {
      const line = draw(STATES.card, { theme });
      expectRole(line, 'label', 1, theme);
      expect(line.style.color, theme).toBe(written(color[theme].text));
      // It wraps: no line limit cuts the date or the caution off.
      expect(line.style.whiteSpace, theme).not.toBe('nowrap');
      expect(line.style.textOverflow, theme).toBe('');
    }
  });

  it('row with its flag', () => {
    for (const theme of ['light', 'dark'] as const) {
      const line = draw(STATES.rowFlag, { theme });
      const flag = screen.getByText('5 days to file');
      const date = screen.getByText('closes Fri, Nov 20');
      // The flag, then the date, 8 points apart in a row that wraps.
      expect(
        flag.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING,
        theme,
      ).toBeTruthy();
      expect(line.style.flexDirection, theme).toBe('row');
      expect(line.style.flexWrap, theme).toBe('wrap');
      expect(line.style.columnGap, theme).toBe(`${String(space.x2)}px`);
      expectRole(date, 'caption', 1, theme);
      expect(date.style.color, theme).toBe(written(color[theme].text));
      expect(flag.style.textTransform, theme).toBe('uppercase');
      // The flag's block carries the highlight.
      expect(flag.parentElement?.style.backgroundColor, theme).toBe(
        written(color[theme].highlight),
      );
    }
    // A row with no flag is its date alone.
    const plain = draw(STATES.row);
    expect(plain.textContent).toBe('closes Fri, Nov 27');
    expect(plain.children).toHaveLength(0);
  });
});
