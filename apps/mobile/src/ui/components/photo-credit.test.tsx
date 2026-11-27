import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { PhotoCredit } from './photo-credit';
import type { PhotoCreditProps } from './photo-credit';
import { GROUND, PREVIEW, STATES } from './photo-credit.fixtures';

type StateName = keyof typeof STATES;

const STATE_NAMES = ['ccBy', 'publicDomain', 'long'] as const;

const ALL: Readonly<Record<StateName, PhotoCreditProps>> = STATES;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one credit, in place of whatever was drawn before, and gives back its words. */
function draw(props: PhotoCreditProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<PhotoCredit {...props} />, options);
  return screen.getByText(props.text);
}

describe('PhotoCredit', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const words = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          expect(words.textContent, name).toBe(ALL[state].text);
          expect(parseFloat(words.style.fontSize), name).toBeCloseTo(
            (typography.mono.style.fontSize ?? 0) * scale,
          );
          // 4 points under the photo, and never laid over it.
          expect(words.parentElement?.style.marginTop, name).toBe(`${String(space.x1)}px`);
          expect(words.parentElement?.style.position, name).toBe('');
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
    expect(STATES.ccBy.text).toBe('Fixture Photographer, CC BY 4.0, cropped');
    expect(STATES.publicDomain.text).toBe('Fixture Photographer, public domain');
    expect(STATES.long.text.length).toBeGreaterThan(80);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const words = draw(ALL[state]);
      // Read as plain text: no role, no name of its own, nothing hidden.
      expect(words.getAttribute('role'), state).toBeNull();
      expect(words.getAttribute('aria-label'), state).toBeNull();
      expect(words.closest('[aria-hidden="true"]'), state).toBeNull();
    }
  });

  it('has a testID', () => {
    // A credit is display only: it takes no testID, because nothing in it can be pressed.
    for (const state of STATE_NAMES) {
      const words = draw(ALL[state]);
      expect(words.getAttribute('data-testid'), state).toBeNull();
      expect(document.querySelectorAll('[role="button"], [role="link"], a, button')).toHaveLength(
        0,
      );
    }
  });

  it('respects reduced motion', () => {
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const words = draw(ALL[state], { reducedMotion });
        expect(words.style.transform, state).toBe('');
        expect(words.style.transition, state).toBe('');
        expect(words.style.animationName, state).toBe('');
      }
    }
  });

  it('mono and grey', () => {
    for (const theme of ['light', 'dark'] as const) {
      const words = draw(STATES.ccBy, { theme });
      expect(words.style.fontFamily).toContain('ChivoMono');
      expect(words.style.textTransform).toBe('');
      expect(words.style.color).toBe(written(color[theme].textSecondary));
    }
  });

  it('a long credit wraps and can be selected', () => {
    const words = draw(STATES.long);
    // No one-line limit, and the text can be copied.
    expect(window.getComputedStyle(words).whiteSpace).not.toBe('nowrap');
    expect(window.getComputedStyle(words).userSelect).toBe('text');
  });
});
