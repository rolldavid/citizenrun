import { BRAND } from '@citizenrun/shared';
import { cleanup, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { Wordmark } from './wordmark';
import type { WordmarkProps } from './wordmark';
import { GROUND, PREVIEW, STATES } from './wordmark.fixtures';

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

const STATE_NAMES = [
  'wordmarkAppBar',
  'wordmarkRail',
  'wordmarkMinimum',
  'monogramRail',
  'inverse',
] as const;

type Drawn = {
  /** The element screen readers meet: the image that carries the name. */
  image: HTMLElement;
  svg: SVGSVGElement;
  /** Everything in the drawing that takes a color. */
  filled: Element[];
};

/** Renders one mark, in place of whatever was drawn before, and finds its parts. */
function draw(props: WordmarkProps, options: RenderWithProvidersOptions = {}): Drawn {
  cleanup();
  views.props = [];
  const view = renderWithProviders(<Wordmark {...props} />, options);
  const image = screen.getByRole('img');
  const svg = view.container.querySelector('svg');
  if (svg === null) {
    throw new Error('the mark drew no svg');
  }
  return { image, svg, filled: [...svg.querySelectorAll('[fill]')] };
}

describe('Wordmark', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <Wordmark {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        expect(view.container.querySelectorAll('svg'), state).toHaveLength(1);
        expect(view.container.querySelectorAll('svg path'), state).toHaveLength(1);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the five states', () => {
    expect(STATES).toEqual({
      wordmarkAppBar: { variant: 'wordmark', capHeight: 17 },
      wordmarkRail: { variant: 'wordmark', capHeight: 20 },
      wordmarkMinimum: { variant: 'wordmark', capHeight: 14 },
      monogramRail: { variant: 'monogram', capHeight: 20 },
      inverse: { variant: 'wordmark', capHeight: 20, tone: 'inverse' },
    });
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    // The inverse mark is made for an ink ground.
    expect(GROUND).toEqual({ inverse: 'inverseBg' });
  });

  it("is an image named with the brand's display name", () => {
    for (const state of STATE_NAMES) {
      const { image, svg } = draw(STATES[state]);
      expect(screen.getByRole('img', { name: BRAND.displayName }), state).toBe(image);
      expect(image.getAttribute('aria-label'), state).toBe(BRAND.displayName);
      // The name is heard once: the outlines themselves are hidden.
      expect(screen.getAllByRole('img'), state).toHaveLength(1);
      expect(image.contains(svg), state).toBe(true);
      expect(svg.getAttribute('aria-hidden'), state).toBe('true');
      // On a phone the mark is one element with the same name.
      const named = views.props.find((props) => props.role === 'img');
      expect(named?.accessible, state).toBe(true);
      expect(named?.accessibilityLabel, state).toBe(BRAND.displayName);
    }
  });

  it('has a label and a role', () => {
    // The mark takes no presses: it is an image with a name, and nothing in it is a control.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(document.querySelectorAll('a, button, [tabindex]'), state).toHaveLength(0);
      expect(document.querySelectorAll('[role]'), state).toHaveLength(1);
    }
  });

  it('has a testID', () => {
    // Nothing in the mark is interactive, so nothing carries an id.
    for (const state of STATE_NAMES) {
      draw(STATES[state]);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    // The mark never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={{ pressed: true }}>
            <Wordmark {...STATES[state]} />
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

  it("uses one color, the tone's", () => {
    for (const theme of ['light', 'dark'] as const) {
      const inverse = draw(STATES.inverse, { theme });
      expect(inverse.filled.length, theme).toBeGreaterThan(0);
      for (const part of inverse.filled) {
        expect(part.getAttribute('fill'), theme).toBe(color[theme].inverseText);
      }
      // Without a tone, and with the primary one, the mark is in the text color.
      for (const props of [
        STATES.wordmarkRail,
        STATES.monogramRail,
        { ...STATES.wordmarkRail, tone: 'primary' } as const,
      ]) {
        const primary = draw(props, { theme });
        expect(primary.filled.length, theme).toBeGreaterThan(0);
        for (const part of primary.filled) {
          expect(part.getAttribute('fill'), theme).toBe(color[theme].text);
        }
      }
    }
    expect(draw(STATES.wordmarkRail).filled.map((part) => part.getAttribute('fill'))).toEqual([
      '#141412',
    ]);
    expect(
      draw(STATES.inverse, { theme: 'dark' }).filled.map((part) => part.getAttribute('fill')),
    ).toEqual(['#141412']);
  });

  it('never draws in the accent, and nothing but the outlines takes a color', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const { image, svg } = draw(STATES[state], { theme });
        expect(svg.outerHTML.toUpperCase(), state).not.toContain(color[theme].accent.toUpperCase());
        expect(svg.querySelectorAll('[stroke]'), state).toHaveLength(0);
        // The box around the outlines paints nothing: the ground shows through.
        expect(image.style.backgroundColor, state).toBe('');
      }
    }
  });

  it('draws the capitals at the cap height, as wide as the outlines', () => {
    // The name is 6249 font units wide and the two letters 1685, on capitals 710 units high.
    const appBar = draw(STATES.wordmarkAppBar);
    expect(appBar.svg.getAttribute('height')).toBe('17');
    expect(appBar.svg.getAttribute('width')).toBe('149.6');
    expect(appBar.svg.getAttribute('viewBox')).toBe('0 0 6249 710');
    const rail = draw(STATES.wordmarkRail);
    expect(rail.svg.getAttribute('height')).toBe('20');
    expect(rail.svg.getAttribute('width')).toBe('176');
    const minimum = draw(STATES.wordmarkMinimum);
    expect(minimum.svg.getAttribute('height')).toBe('14');
    expect(minimum.svg.getAttribute('width')).toBe('123.2');
    const monogram = draw(STATES.monogramRail);
    expect(monogram.svg.getAttribute('height')).toBe('20');
    expect(monogram.svg.getAttribute('width')).toBe('47.5');
    expect(monogram.svg.getAttribute('viewBox')).toBe('0 0 1685 710');
    // The two variants are different outlines.
    expect(monogram.svg.querySelector('path')?.getAttribute('d')).not.toBe(
      rail.svg.querySelector('path')?.getAttribute('d'),
    );
  });

  it("is a box of the drawing's own size, with no room around it", () => {
    const rail = draw(STATES.wordmarkRail).image;
    expect(rail.style.height).toBe('20px');
    expect(Number.parseFloat(rail.style.width)).toBeCloseTo(176.03, 2);
    const monogram = draw(STATES.monogramRail).image;
    expect(monogram.style.height).toBe('20px');
    expect(Number.parseFloat(monogram.style.width)).toBeCloseTo(47.46, 2);
    // The clear space is the caller's: the mark adds none of its own.
    for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
      expect(rail.style[`padding${side}`], side).toBe('');
      expect(rail.style[`margin${side}`], side).toBe('');
    }
  });

  it('does not grow with the text size', () => {
    const scaled = draw(STATES.wordmarkAppBar, { textScale: 1.3 });
    expect(scaled.svg.getAttribute('height')).toBe('17');
    expect(scaled.image.style.height).toBe('17px');
  });

  it('refuses a cap height under the minimum', () => {
    // React reports the thrown error on the console as well.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup();
    for (const variant of ['wordmark', 'monogram'] as const) {
      expect(() =>
        renderWithProviders(
          <Wordmark variant={variant} capHeight={size.wordmarkCap.minimum - 1} />,
        ),
      ).toThrow('Wordmark cap height is under the minimum');
      cleanup();
    }
    errors.mockRestore();
    // The minimum itself is drawn.
    expect(
      draw({ variant: 'wordmark', capHeight: size.wordmarkCap.minimum }).svg.getAttribute('height'),
    ).toBe(String(size.wordmarkCap.minimum));
  });
});
