import { cleanup } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { ConfidenceBadge } from './confidence-badge';
import type { ConfidenceBadgeProps } from './confidence-badge';
import { GROUND, PREVIEW, STATES } from './confidence-badge.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = ['high', 'medium', 'low', 'complete', 'partial', 'minimal'] as const;

const ALL: Readonly<Record<StateName, ConfidenceBadgeProps>> = STATES;

const WORDS: Readonly<Record<StateName, string>> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  complete: 'Complete record',
  partial: 'Partial record',
  minimal: 'Minimal record',
};

const LIT: Readonly<Record<StateName, number>> = {
  high: 3,
  medium: 2,
  low: 1,
  complete: 3,
  partial: 2,
  minimal: 1,
};

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one badge, in place of whatever was drawn before, and gives back its line. */
function draw(props: ConfidenceBadgeProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  const view = renderWithProviders(<ConfidenceBadge {...props} />, options);
  const line = [...view.container.querySelectorAll<HTMLElement>('*')].find(
    (part) => part.style.flexDirection === 'row' && part.style.alignItems === 'center',
  );
  if (line === undefined) {
    throw new Error('no badge was drawn');
  }
  return line;
}

/** The pips of a badge: every drawing of the pip's size. */
function pipsOf(line: HTMLElement): HTMLElement[] {
  return [...line.querySelectorAll<HTMLElement>('*')].filter(
    (part) =>
      part.style.width === `${String(size.confidencePip.width)}px` &&
      part.style.height === `${String(size.confidencePip.height)}px`,
  );
}

function isLit(pip: HTMLElement): boolean {
  return pip.style.backgroundColor !== '';
}

describe('ConfidenceBadge', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const line = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const ink = written(color[theme].textSecondary);
          const pips = pipsOf(line);
          expect(pips, name).toHaveLength(size.confidencePips);
          // Lit pips are solid, unlit pips a hairline outline, all in the color of the words.
          for (const pip of pips) {
            if (isLit(pip)) {
              expect(pip.style.backgroundColor, name).toBe(ink);
              expect(pip.style.borderWidth, name).toBe('');
            } else {
              expect(pip.style.borderWidth, name).toBe(`${String(rule.hairline)}px`);
              expect(pip.style.borderColor, name).toBe(ink);
            }
            expect(pip.style.borderRadius, name).toBe('0px');
          }
          expect(pips[0]?.parentElement?.style.columnGap, name).toBe(`${String(space.pip)}px`);
          // The words: mono, sentence case, in the secondary color, 8 points after the pips.
          const words = line.lastElementChild as HTMLElement;
          expect(words.textContent, name).toBe(WORDS[state]);
          expect(words.style.fontFamily, name).toContain('ChivoMono');
          expect(words.style.textTransform, name).toBe('');
          expect(parseFloat(words.style.fontSize), name).toBeCloseTo(
            (typography.mono.style.fontSize ?? 0) * scale,
          );
          expect(words.style.color, name).toBe(ink);
          expect(line.style.columnGap, name).toBe(`${String(space.x2)}px`);
          // No box round the badge.
          expect(line.style.borderWidth, name).toBe('');
          expect(line.style.backgroundColor, name).toBe('');
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
    for (const state of ['high', 'medium', 'low'] as const) {
      expect(STATES[state]).toEqual({ kind: 'confidence', level: state });
    }
    for (const state of ['complete', 'partial', 'minimal'] as const) {
      expect(STATES[state]).toEqual({ kind: 'record', level: state });
    }
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const line = draw(ALL[state]);
      // The words are read as text: the badge has no role and no name of its own.
      expect(line.getAttribute('role'), state).toBeNull();
      expect(line.getAttribute('aria-label'), state).toBeNull();
      expect(line.textContent, state).toBe(WORDS[state]);
    }
  });

  it('has a testID', () => {
    // A badge is display only: it takes no testID, because nothing in it can be pressed.
    for (const state of STATE_NAMES) {
      const line = draw(ALL[state]);
      expect(line.getAttribute('data-testid'), state).toBeNull();
      expect(document.querySelectorAll('[role="button"], [role="link"], a, button')).toHaveLength(
        0,
      );
    }
  });

  it('respects reduced motion', () => {
    // A badge never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const line = draw(ALL[state], { reducedMotion });
        for (const part of [line, ...line.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('pips by level', () => {
    for (const state of STATE_NAMES) {
      const pips = pipsOf(draw(ALL[state]));
      // The lit pips come first.
      expect(
        pips.map((pip) => isLit(pip)),
        state,
      ).toEqual([0, 1, 2].map((index) => index < LIT[state]));
    }
  });

  it('words read, pips hidden', () => {
    const line = draw(STATES.medium);
    const pips = pipsOf(line);
    const group = pips[0]?.parentElement;
    expect(group?.getAttribute('aria-hidden')).toBe('true');
    for (const pip of pips) {
      expect(pip.parentElement).toBe(group);
    }
    // What is left for a screen reader is the words.
    const read = [...line.children].filter((part) => part.getAttribute('aria-hidden') !== 'true');
    expect(read.map((part) => part.textContent)).toEqual(['Medium confidence']);
  });

  it('no level has a color of its own', () => {
    for (const theme of ['light', 'dark'] as const) {
      const inks = new Set<string>();
      for (const state of STATE_NAMES) {
        const line = draw(ALL[state], { theme });
        inks.add((line.lastElementChild as HTMLElement).style.color);
        for (const pip of pipsOf(line)) {
          inks.add(isLit(pip) ? pip.style.backgroundColor : pip.style.borderColor);
        }
      }
      expect([...inks]).toEqual([written(color[theme].textSecondary)]);
    }
  });
});
