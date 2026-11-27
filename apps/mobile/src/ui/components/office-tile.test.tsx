import { cleanup, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, radius, size } from '@/ui/tokens';

import { OfficeTile } from './office-tile';
import type { OfficeTileProps } from './office-tile';
import { GROUND, PREVIEW, STATES } from './office-tile.fixtures';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A glyph loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('an office glyph loads no asset');
  },
}));

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

type StateName = keyof typeof STATES;

const STATE_NAMES = ['sm', 'md', 'lg', 'placeholderGlyph', 'icon', 'plain', 'labelled'] as const;

const ALL: Readonly<Record<StateName, OfficeTileProps>> = STATES;

/** The pin of C-Icon's `pin`: the one interface icon a tile holds in the fixtures. */
const PIN = 'M12 21s-6.500-6-6.500-11a6.500 6.500 0 0 1 13 0c0 5-6.500 11-6.500 11zM12 8v4';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one tile, in place of whatever was drawn before, and gives back its box. */
function draw(props: OfficeTileProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  views.props = [];
  const { container } = renderWithProviders(<OfficeTile {...props} />, options);
  const tile = container.querySelector<HTMLElement>('[style*="border-radius"]');
  if (tile === null) {
    throw new Error('the tile draws no box');
  }
  return tile;
}

/** The props the tile's own View was given. */
function tileProps(): Record<string, unknown> {
  const found = views.props.find((props) => 'aria-hidden' in props || 'aria-label' in props);
  if (found === undefined) {
    throw new Error('no tile was rendered');
  }
  return found;
}

/** The fills and strokes written inside a drawing. */
function inks(drawing: SVGSVGElement): string[] {
  const found = new Set<string>();
  for (const part of drawing.querySelectorAll('*')) {
    for (const name of ['fill', 'stroke']) {
      const value = part.getAttribute(name);
      if (value !== null && value !== 'none') {
        found.add(written(value));
      }
    }
  }
  return [...found];
}

describe('OfficeTile', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const tile = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const side = `${String(size.officeTile[ALL[state].size])}px`;
          // Always a square of the tile's size, on the ink ground, with the control radius: a
          // tile is a mark, so it keeps its size whatever the text size.
          expect(tile.style.width, name).toBe(side);
          expect(tile.style.height, name).toBe(side);
          expect(tile.style.borderRadius, name).toBe(`${String(radius.control)}px`);
          expect(tile.style.backgroundColor, name).toBe(written(color[theme].inverseBg));
          expect(tile.style.alignItems, name).toBe('center');
          expect(tile.style.justifyContent, name).toBe('center');
          expect(tile.textContent, name).toBe('');
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
    expect(STATES.sm).toEqual({ illustration: 'county-treasurer', size: 'sm' });
    expect(STATES.md).toEqual({ illustration: 'county-treasurer', size: 'md' });
    expect(STATES.lg).toEqual({ illustration: 'county-treasurer', size: 'lg' });
    expect(STATES.placeholderGlyph).toEqual({ illustration: 'state-treasurer', size: 'md' });
    expect(STATES.icon).toEqual({ illustration: null, icon: 'pin', size: 'md' });
    expect(STATES.plain).toEqual({ illustration: null, size: 'md' });
    expect(STATES.labelled).toEqual({
      illustration: 'county-treasurer',
      size: 'md',
      label: 'County Treasurer',
      decorative: false,
    });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const tile = draw(ALL[state]);
      if (state === 'labelled') {
        expect(screen.getByRole('img', { name: 'County Treasurer' }), state).toBe(tile);
      } else {
        // A tile beside the office's name says nothing.
        expect(tile.getAttribute('role'), state).toBeNull();
        expect(tile.getAttribute('aria-label'), state).toBeNull();
        expect(tile.getAttribute('aria-hidden'), state).toBe('true');
      }
      // The drawing inside never has a name of its own.
      expect(tile.querySelectorAll('[role], [aria-label]'), state).toHaveLength(0);
    }
  });

  it('has a testID', () => {
    // A tile is display only: it takes no testID, because nothing in it can be pressed.
    for (const state of STATE_NAMES) {
      const tile = draw(ALL[state]);
      expect(tile.getAttribute('data-testid'), state).toBeNull();
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
      expect(document.querySelectorAll('[role="button"], [role="link"], a, button')).toHaveLength(
        0,
      );
    }
  });

  it('respects reduced motion', () => {
    // A tile never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const tile = draw(ALL[state], { reducedMotion });
        for (const part of [tile, ...tile.querySelectorAll<HTMLElement | SVGElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('the glyph at 60 percent', () => {
    for (const theme of ['light', 'dark'] as const) {
      const tile = draw(STATES.md, { theme });
      expect(tile.style.width).toBe('36px');
      expect(tile.style.height).toBe('36px');
      expect(tile.style.borderRadius).toBe('4px');
      expect(tile.style.backgroundColor).toBe(written(color[theme].inverseBg));
      const glyphs = tile.querySelectorAll('svg');
      expect(glyphs).toHaveLength(1);
      const glyph = glyphs[0];
      if (glyph === undefined) {
        throw new Error('the tile draws no glyph');
      }
      // 22 of 36: the glyph of the 24 grid, in the one color that reads on the ink tile.
      expect(glyph.getAttribute('width')).toBe('22');
      expect(glyph.getAttribute('height')).toBe('22');
      expect(glyph.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(inks(glyph)).toEqual([written(color[theme].inverseText)]);
    }
    // The glyph is 60% of every tile, to the point.
    for (const name of ['sm', 'md', 'lg'] as const) {
      const glyph = draw(STATES[name]).querySelector('svg');
      expect(glyph?.getAttribute('width'), name).toBe(String(size.officeGlyph[name]));
      expect(size.officeGlyph[name], name).toBe(Math.round(size.officeTile[name] * 0.6));
    }
  });

  it('icon, plain and placeholder', () => {
    // An icon takes the glyph's place, in the same one color, whatever the illustration.
    for (const props of [STATES.icon, { ...STATES.icon, illustration: 'county-treasurer' }]) {
      const icon = draw(props).querySelectorAll('svg');
      expect(icon).toHaveLength(1);
      expect(icon[0]?.getAttribute('width')).toBe(String(size.icon.medium));
      expect(icon[0]?.querySelector('path')?.getAttribute('d')).toBe(PIN);
      expect(icon[0] === undefined ? [] : inks(icon[0])).toEqual([
        written(color.light.inverseText),
      ]);
    }
    // With neither, the plain tile: the ink square alone.
    const plain = draw(STATES.plain);
    expect(plain.children).toHaveLength(0);
    expect(plain.style.backgroundColor).toBe(written(color.light.inverseBg));

    // An office type with no glyph of its own still gets one, and an unknown id draws the same
    // glyph as the city council rather than nothing.
    const placeholder = draw(STATES.placeholderGlyph).querySelector('svg');
    expect(placeholder?.getAttribute('width')).toBe('22');
    expect(placeholder?.querySelectorAll('path, rect, circle, polygon').length).toBeGreaterThan(0);
    const unknown = draw({ illustration: 'no-such-office', size: 'md' }).querySelector('svg');
    const council = draw({ illustration: 'city-council', size: 'md' }).querySelector('svg');
    expect(unknown?.innerHTML).toBe(council?.innerHTML);
    expect(unknown?.innerHTML).not.toBe('');
  });

  it('decorative unless labelled', () => {
    // Without a label the tile is hidden, on the page and on a phone.
    draw(STATES.md);
    expect(tileProps()).toMatchObject({
      'aria-hidden': true,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    // With one it is an image with that name, and one element for a phone's screen reader.
    const named = draw(STATES.labelled);
    expect(named.getAttribute('role')).toBe('img');
    expect(named.getAttribute('aria-label')).toBe('County Treasurer');
    expect(named.getAttribute('aria-hidden')).toBeNull();
    expect(tileProps()).toMatchObject({ accessible: true, role: 'img' });
    // A caller that prints the name beside the tile hides it again.
    const beside = draw({ ...STATES.labelled, decorative: true });
    expect(beside.getAttribute('aria-hidden')).toBe('true');
    expect(beside.getAttribute('role')).toBeNull();
    // A tile with no name cannot be announced, whatever the caller asks.
    const nameless = draw({ illustration: 'county-treasurer', size: 'md', decorative: false });
    expect(nameless.getAttribute('aria-hidden')).toBe('true');
  });
});
