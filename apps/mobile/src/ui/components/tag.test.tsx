import { BRAND } from '@citizenrun/shared';
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, radius, rule, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { Tag } from './tag';
import type { TagProps } from './tag';
import { GROUND, PREVIEW, STATES } from './tag.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = ['outline', 'solid', 'unknown', 'party', 'long'] as const;

const ALL: Readonly<Record<StateName, TagProps>> = STATES;

const UNKNOWN = 'not known yet';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one tag, in place of whatever was drawn before, and gives back its words and its box. */
function draw(
  props: TagProps,
  options: RenderWithProvidersOptions = {},
): { words: HTMLElement; box: HTMLElement } {
  cleanup();
  renderWithProviders(<Tag {...props} />, options);
  const words = screen.getByText(props.label ?? UNKNOWN);
  const box = words.parentElement;
  if (box === null) {
    throw new Error('the tag draws no box');
  }
  return { words, box };
}

describe('Tag', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const { words, box } = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // A hairline box as wide as its words, with the tag radius and the tag padding.
          expect(box.style.alignSelf, name).toBe('flex-start');
          expect(box.style.borderWidth, name).toBe(`${String(rule.hairline)}px`);
          expect(box.style.borderRadius, name).toBe(`${String(radius.tag)}px`);
          expect(box.style.paddingTop, name).toBe(`${String(space.x1)}px`);
          expect(box.style.paddingLeft, name).toBe(`${String(space.x2)}px`);
          // Never tilted.
          expect(box.style.transform, name).toBe('');
          // The mono label: capitals are a style, and the text grows with the text size.
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

  it('the fixtures hold the five states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.outline).toEqual({ variant: 'outline', label: 'Not verified' });
    expect(STATES.solid).toEqual({ variant: 'solid', label: 'Filed' });
    expect(STATES.unknown).toEqual({ variant: 'unknown' });
    expect(STATES.party).toEqual({ variant: 'outline', label: 'Independent' });
    expect(STATES.long).toEqual({ variant: 'outline', label: 'Committee registered' });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const { words, box } = draw(ALL[state]);
      // Read as plain text, in sentence case: no role, no name of its own, nothing hidden.
      expect(words.textContent, state).toBe(ALL[state].label ?? UNKNOWN);
      expect(box.getAttribute('role'), state).toBeNull();
      expect(box.getAttribute('aria-label'), state).toBeNull();
      expect(words.closest('[aria-hidden="true"]'), state).toBeNull();
    }
  });

  it('has a testID', () => {
    // A tag is display only: it takes no testID, because nothing in it can be pressed.
    for (const state of STATE_NAMES) {
      const { box } = draw(ALL[state]);
      expect(box.getAttribute('data-testid'), state).toBeNull();
      expect(document.querySelectorAll('[role="button"], [role="link"], a, button')).toHaveLength(
        0,
      );
    }
  });

  it('respects reduced motion', () => {
    // A tag never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const { words, box } = draw(ALL[state], { reducedMotion });
        for (const part of [box, words]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('shows not known yet', () => {
    const { words } = draw(STATES.unknown);
    expect(words.textContent).toBe('not known yet');
  });

  it('unknown reads not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { words, box } = draw({ variant: 'unknown' }, { theme });
      expect(words.textContent).toBe('not known yet');
      // A dashed hairline at full contrast: the words are in the text color, on no fill.
      expect(box.style.borderStyle).toBe('dashed');
      expect(box.style.borderColor).toBe(written(color[theme].rule));
      expect(box.style.backgroundColor).toBe('');
      expect(box.style.opacity).toBe('');
      expect(words.style.color).toBe(written(color[theme].text));
    }
    // A label of the caller's takes the place of the words.
    expect(draw({ variant: 'unknown', label: 'Date not known yet' }).words.textContent).toBe(
      'Date not known yet',
    );
    // Only the unknown tag is dashed.
    expect(draw(STATES.outline).box.style.borderStyle).not.toBe('dashed');
    expect(draw(STATES.solid).box.style.borderStyle).not.toBe('dashed');
  });

  it('solid inverts', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { words, box } = draw(STATES.solid, { theme });
      expect(box.style.backgroundColor).toBe(written(color[theme].inverseBg));
      expect(box.style.borderColor).toBe(written(color[theme].inverseBg));
      expect(words.style.color).toBe(written(color[theme].inverseText));
      // An outline tag has no fill, a rule for its box and the text color for its words.
      const outline = draw(STATES.outline, { theme });
      expect(outline.box.style.backgroundColor).toBe('');
      expect(outline.box.style.borderColor).toBe(written(color[theme].rule));
      expect(outline.words.style.color).toBe(written(color[theme].text));
    }
  });

  it('the product name throws', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const label of [BRAND.displayName, `Runs on ${BRAND.displayName.toLowerCase()}`]) {
      for (const variant of ['outline', 'solid', 'unknown'] as const) {
        cleanup();
        expect(() => {
          renderWithProviders(<Tag variant={variant} label={label} />);
        }, `${variant} ${label}`).toThrow('A tag never carries the product name.');
      }
    }
    errors.mockRestore();
  });

  it('never a target', () => {
    for (const state of STATE_NAMES) {
      const { box } = draw(ALL[state]);
      expect(screen.queryAllByRole('button'), state).toHaveLength(0);
      expect(screen.queryAllByRole('link'), state).toHaveLength(0);
      expect(box.getAttribute('tabindex'), state).toBeNull();
      expect(box.style.cursor, state).toBe('');
    }
  });

  it('a long label stays on one line', () => {
    cleanup();
    const view = renderWithProviders(<Tag {...STATES.long} />);
    const words = screen.getByText(STATES.long.label);
    // The web writes a one-line limit as a class that keeps the words from wrapping.
    expect(window.getComputedStyle(words).whiteSpace).toBe('nowrap');
    expect(view.container.textContent).toBe(STATES.long.label);
  });
});
