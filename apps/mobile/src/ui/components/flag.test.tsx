import { BRAND } from '@citizenrun/shared';
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, radius, rule, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { Flag } from './flag';
import type { FlagProps } from './flag';
import { GROUND, PREVIEW, STATES } from './flag.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = ['fiveDays', 'oneDay', 'sevenDays'] as const;

const ALL: Readonly<Record<StateName, FlagProps>> = STATES;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one flag, in place of whatever was drawn before, and gives back its words and its block. */
function draw(
  props: FlagProps,
  options: RenderWithProvidersOptions = {},
): { words: HTMLElement; block: HTMLElement } {
  cleanup();
  renderWithProviders(<Flag {...props} />, options);
  const words = screen.getByText(props.label);
  const block = words.parentElement;
  if (block === null) {
    throw new Error('the flag draws no block');
  }
  return { words, block };
}

describe('Flag', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const { words, block } = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          expect(block.style.alignSelf, name).toBe('flex-start');
          expect(block.style.paddingTop, name).toBe(`${String(space.x1)}px`);
          expect(block.style.paddingLeft, name).toBe(`${String(space.x2)}px`);
          expect(words.style.textTransform, name).toBe('uppercase');
          expect(words.style.fontFamily, name).toContain('ChivoMono');
          expect(parseFloat(words.style.fontSize), name).toBeCloseTo(
            (typography.monoLabel.style.fontSize ?? 0) * scale,
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
    expect(STATES.fiveDays.label).toBe('5 days to file');
    expect(STATES.oneDay.label).toBe('1 day to file');
    expect(STATES.sevenDays.label).toBe('7 days to file');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const { words, block } = draw(ALL[state]);
      // Read as plain text, in sentence case: no role, no name of its own, nothing hidden.
      expect(words.textContent, state).toBe(ALL[state].label);
      expect(block.getAttribute('role'), state).toBeNull();
      expect(block.getAttribute('aria-label'), state).toBeNull();
      expect(words.closest('[aria-hidden="true"]'), state).toBeNull();
    }
  });

  it('has a testID', () => {
    // A flag is display only: it takes no testID, because nothing in it can be pressed.
    for (const state of STATE_NAMES) {
      const { block } = draw(ALL[state]);
      expect(block.getAttribute('data-testid'), state).toBeNull();
      expect(document.querySelectorAll('[role="button"], [role="link"], a, button')).toHaveLength(
        0,
      );
      expect(block.getAttribute('tabindex'), state).toBeNull();
    }
  });

  it('respects reduced motion', () => {
    // A flag is still by itself, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const { words, block } = draw(ALL[state], { reducedMotion });
        for (const part of [block, words]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }
  });

  it('volt with an ink keyline', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { words, block } = draw(STATES.fiveDays, { theme });
      expect(block.style.backgroundColor).toBe(written(color[theme].highlight));
      expect(block.style.borderWidth).toBe(`${String(rule.hairline)}px`);
      expect(block.style.borderColor).toBe(written(color[theme].onHighlight));
      expect(block.style.borderRadius).toBe(`${String(radius.none)}px`);
      expect(words.style.color).toBe(written(color[theme].onHighlight));
      // Never tilted.
      expect(block.style.transform).toBe('');
    }
  });

  it('the product name throws', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const label of [BRAND.displayName, `5 days to ${BRAND.displayName.toLowerCase()}`]) {
      cleanup();
      expect(() => {
        renderWithProviders(<Flag label={label} />);
      }, label).toThrow('A flag never carries the product name.');
    }
    errors.mockRestore();
  });
});
