import { cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size } from '@/ui/tokens';

import { EmptyChair } from './empty-chair';
import type { EmptyChairProps } from './empty-chair';
import { GROUND, PREVIEW, STATES } from './empty-chair.fixtures';
import { InteractionPreview } from './pressable';

// The props each View receives, so the cases below can read what a phone's screen reader is told:
// the web drops those props before they reach the page.
const views = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>();
  return {
    ...actual,
    View: (props: ReactNative.ViewProps): ReactElement => {
      views.props.push({ ...props });
      return createElement(actual.View, props);
    },
  };
});

const STATE_NAMES = ['default', 'small'] as const;

type Drawn = {
  /** The view that hides the drawing from screen readers. */
  hidden: HTMLElement;
  svg: SVGSVGElement;
  /** The fill of each shape, in drawing order. */
  fills: (string | null)[];
};

/** Renders one chair, in place of whatever was drawn before, and finds its parts. */
function draw(props: EmptyChairProps, options: RenderWithProvidersOptions = {}): Drawn {
  cleanup();
  views.props = [];
  const view = renderWithProviders(<EmptyChair {...props} />, options);
  const svg = view.container.querySelector('svg');
  const hidden = svg?.parentElement ?? null;
  if (svg === null || hidden === null) {
    throw new Error('the chair drew no svg');
  }
  return {
    hidden,
    svg,
    fills: [...svg.querySelectorAll('[fill]')].map((shape) => shape.getAttribute('fill')),
  };
}

describe('EmptyChair', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <EmptyChair {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        expect(view.container.querySelectorAll('svg'), state).toHaveLength(1);
        // The disc, the three bars of the chair, the seat and the ground line.
        expect(view.container.querySelectorAll('svg circle'), state).toHaveLength(1);
        expect(view.container.querySelectorAll('svg rect'), state).toHaveLength(5);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the two states', () => {
    expect(STATES).toEqual({ default: {}, small: { size: 100 } });
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('is hidden from screen readers', () => {
    for (const state of STATE_NAMES) {
      const { hidden, svg } = draw(STATES[state]);
      expect(hidden.getAttribute('aria-hidden'), state).toBe('true');
      expect(hidden.contains(svg), state).toBe(true);
      // Decorative: it has no name and no role of its own.
      expect(
        document.querySelectorAll('[aria-label], [aria-labelledby], [role], title'),
        state,
      ).toHaveLength(0);
      // What hides it on phones.
      const hiddenProps = views.props.find((props) => props['aria-hidden'] === true);
      expect(hiddenProps?.accessibilityElementsHidden, state).toBe(true);
      expect(hiddenProps?.importantForAccessibility, state).toBe('no-hide-descendants');
    }
  });

  it('has a label and a role', () => {
    // The drawing takes no presses and says nothing.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(
        document.querySelectorAll('a, button, [role], [tabindex], [aria-label]'),
        state,
      ).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    // Nothing in the drawing is interactive, so nothing carries an id.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    // The chair never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={{ pressed: true }}>
            <EmptyChair {...STATES[state]} />
          </InteractionPreview>,
          { reducedMotion },
        );
        for (const element of view.container.querySelectorAll<HTMLElement>('*')) {
          expect(element.style.transform, state).toBe('');
          expect(element.style.transitionProperty, state).toBe('');
          expect(element.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('draws at the drawing size by default', () => {
    expect(size.drawingEmpty).toBe(200);
    const chair = draw(STATES.default);
    expect(chair.svg.getAttribute('width')).toBe('200');
    expect(chair.hidden.style.width).toBe('200px');
    // Its width is the one size it takes: nothing fixes the height of its box.
    expect(chair.hidden.style.height).toBe('');

    const small = draw(STATES.small);
    expect(small.svg.getAttribute('width')).toBe('100');
    expect(small.hidden.style.width).toBe('100px');
    expect(draw({ size: 148 }).svg.getAttribute('width')).toBe('148');
  });

  it('is trimmed to the drawing, so the text under it starts close to the ground line', () => {
    // The 96-unit grid without the empty rows above and below: 84 units high.
    const chair = draw(STATES.default);
    expect(chair.svg.getAttribute('viewBox')).toBe('0 8 96 84');
    expect(chair.svg.getAttribute('height')).toBe('175');
    expect(draw(STATES.small).svg.getAttribute('height')).toBe('87.5');
  });

  it('uses the accent only for the seat', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { svg } = draw(STATES.default, { theme });
      const accented = [...svg.querySelectorAll('[fill]')].filter(
        (shape) => shape.getAttribute('fill') === color[theme].accent,
      );
      expect(accented, theme).toHaveLength(1);
      // The seat: the 20 by 9 block on the seat rail.
      const seat = accented[0];
      expect(seat?.tagName, theme).toBe('rect');
      expect(seat?.getAttribute('width'), theme).toBe('20');
      expect(seat?.getAttribute('height'), theme).toBe('9');
      expect(svg.querySelectorAll('[stroke]'), theme).toHaveLength(0);
    }
  });

  it('is ink on the ground with one gray disc, in light and dark', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { hidden, fills } = draw(STATES.default, { theme });
      const { text, textSecondary, accent } = color[theme];
      expect(fills, theme).toEqual([textSecondary, text, text, text, accent, text]);
      // The box paints nothing: the chair stands on whatever ground it is put on.
      expect(hidden.style.backgroundColor, theme).toBe('');
    }
    expect(draw(STATES.default).fills).toEqual([
      '#535148',
      '#141412',
      '#141412',
      '#141412',
      '#F04E14',
      '#141412',
    ]);
  });

  it('does not grow with the text size', () => {
    expect(draw(STATES.default, { textScale: 1.3 }).svg.getAttribute('width')).toBe('200');
  });
});
