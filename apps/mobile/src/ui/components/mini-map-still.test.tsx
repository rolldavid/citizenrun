import type { TFunction } from '@citizenrun/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getI18n } from '@/lib/i18n';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { MiniMapStill, miniMapText } from './mini-map-still';
import type { MiniMapStillProps } from './mini-map-still';
import { GROUND, PREVIEW, STATES } from './mini-map-still.fixtures';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// Neither the shape nor an icon loads an asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a mini map loads no asset');
  },
}));

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'exact',
  'approximate',
  'noOutline',
  'pressable',
  'longPlace',
  'invalidOutline',
] as const;

const ALL: Readonly<Record<StateName, MiniMapStillProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const CHEVRON_RIGHT = 'M9 5l7 7-7 7';
const APPROXIMATE = 'Check which district you live in.';
/** The side of the shape's box: the square less its room at each side. */
const SHAPE = size.miniMap - 2 * space.x2;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one row, in place of whatever was drawn before, and gives back the element with its id. */
function draw(props: MiniMapStillProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<MiniMapStill {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** The keylined square of a row. */
function squareOf(row: HTMLElement): HTMLElement {
  const square = [...row.querySelectorAll<HTMLElement>('*')].find(
    (part) =>
      part.style.width === `${String(size.miniMap)}px` &&
      part.style.height === `${String(size.miniMap)}px`,
  );
  if (square === undefined) {
    throw new Error('the row draws no square');
  }
  return square;
}

/** True when the row draws the chevron of a row that opens something. */
function hasChevron(row: HTMLElement): boolean {
  return [...row.querySelectorAll('path')].some((path) => path.getAttribute('d') === CHEVRON_RIGHT);
}

describe('MiniMapStill', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const row = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // The square on the surface inside its soft keyline: it does not grow with the text.
          const square = squareOf(row);
          expect(square.style.backgroundColor, name).toBe(written(color[theme].surface));
          expect(square.style.borderWidth, name).toBe(`${String(rule.hairline)}px`);
          expect(square.style.borderColor, name).toBe(written(color[theme].ruleSoft));
          // The place in `label`, the level in `caption`, both in the text color.
          const place = within(row).getByText(props.placeName);
          expect(parseFloat(place.style.fontSize), name).toBeCloseTo(
            (typography.label.style.fontSize ?? 0) * scale,
          );
          expect(place.style.color, name).toBe(written(color[theme].text));
          const level = within(row).getByText(props.levelLabel);
          expect(parseFloat(level.style.fontSize), name).toBeCloseTo(
            (typography.caption.style.fontSize ?? 0) * scale,
          );
          expect(level.style.color, name).toBe(written(color[theme].text));
          expect(
            place.compareDocumentPosition(level) & Node.DOCUMENT_POSITION_FOLLOWING,
            name,
          ).toBeTruthy();
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.mini-map-still-${kebab(state)}`);
    }
    expect(STATES.exact).toMatchObject({
      outline: { svg: 'M120 0 L1000 140 L880 1000 L0 760 Z', bbox: [0, 0, 20000, 20000] },
      placeName: 'Fixture Wren County',
      levelLabel: 'County',
      approximateText: null,
      onPress: null,
    });
    expect(STATES.approximate.approximateText).toBe(APPROXIMATE);
    expect(STATES.noOutline.outline).toBeNull();
    expect(STATES.pressable.onPress).toBeTypeOf('function');
    expect(STATES.pressable.openLabel).toBe('Show Fixture Wren County on the map');
    expect(STATES.longPlace.placeName).toBe(
      'Fixture Charlotte and Mecklenburg County Consolidated Area',
    );
    expect(STATES.invalidOutline.outline.svg).toBe('M0 0 C10 10 Z');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const row = draw(props);
      if (state === 'pressable') {
        expect(row.getAttribute('role'), state).toBe('button');
        // The words the row shows come first, then what a press does.
        expect(row.getAttribute('aria-label'), state).toBe(
          'Fixture Wren County. County. Show Fixture Wren County on the map',
        );
        continue;
      }
      // A row that opens nothing is plain text beside a picture: no role and no name of its own.
      expect(row.getAttribute('role'), state).toBeNull();
      expect(row.getAttribute('aria-label'), state).toBeNull();
      expect(screen.queryByRole('button'), state).toBeNull();
      expect(squareOf(row).getAttribute('aria-hidden'), state).toBe('true');
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const row = draw(ALL[state]);
      expect(row.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    // A still: nothing in it moves, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const row = draw(ALL[state], { reducedMotion });
        for (const part of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }
  });

  it('the shape at 80 in ink', () => {
    expect(SHAPE).toBe(80);
    for (const theme of ['light', 'dark'] as const) {
      const row = draw(STATES.exact, { theme });
      const square = squareOf(row);
      expect(square.style.width).toBe(`${String(size.miniMap)}px`);
      expect(square.style.height).toBe(`${String(size.miniMap)}px`);
      expect(square.style.borderColor).toBe(written(color[theme].ruleSoft));
      expect(square.style.borderWidth).toBe(`${String(rule.hairline)}px`);
      // The keyline and the room inside it leave the shape its 80 points.
      expect(
        size.miniMap -
          2 * (parseFloat(square.style.borderWidth) + parseFloat(square.style.padding)),
      ).toBe(SHAPE);
      expect(square.getAttribute('aria-hidden')).toBe('true');
      const shapes = square.querySelectorAll('svg');
      expect(shapes).toHaveLength(1);
      const shape = shapes[0];
      expect(shape?.getAttribute('width')).toBe(String(SHAPE));
      expect(shape?.getAttribute('height')).toBe(String(SHAPE));
      expect(shape?.getAttribute('viewBox')).toBe(`0 0 ${String(SHAPE)} ${String(SHAPE)}`);
      // One solid shape in the text color, with no stroke.
      const paths = shape?.querySelectorAll('path') ?? [];
      expect(paths).toHaveLength(1);
      expect(paths[0]?.getAttribute('d')).toBe(STATES.exact.outline.svg);
      expect(paths[0]?.getAttribute('fill')).toBe(color[theme].text);
      expect(paths[0]?.getAttribute('stroke')).toBeNull();
    }
  });

  it('no outline, no chevron, no target', () => {
    const row = draw(STATES.noOutline);
    expect(squareOf(row).querySelector('svg')).toBeNull();
    expect(row.querySelector('svg')).toBeNull();
    expect(hasChevron(row)).toBe(false);
    expect(screen.queryByRole('button')).toBeNull();
    // Even when a caller passes a press: with no shape there is nothing to show on a map.
    const onPress = vi.fn();
    const given = draw({ ...STATES.noOutline, onPress });
    expect(screen.queryByRole('button')).toBeNull();
    expect(hasChevron(given)).toBe(false);
    fireEvent.click(given);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('no chevron and no target without onPress', () => {
    const row = draw(STATES.exact);
    expect(screen.queryByRole('button')).toBeNull();
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
    expect(hasChevron(row)).toBe(false);
  });

  it('pressable row', () => {
    const onPress = vi.fn();
    const row = draw({ ...STATES.pressable, onPress });
    expect(screen.getAllByRole('button')).toEqual([row]);
    expect(
      screen.getByRole('button', {
        name: 'Fixture Wren County. County. Show Fixture Wren County on the map',
      }),
    ).toBe(row);
    // At least as high as the smallest target.
    expect(
      [row, ...row.querySelectorAll<HTMLElement>('*')].some(
        (part) => part.style.minHeight === `${String(size.target)}px`,
      ),
    ).toBe(true);
    expect(hasChevron(row)).toBe(true);
    fireEvent.click(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a pressable row is named by every line it shows, then by what it opens', () => {
    const row = draw({ ...STATES.approximate, onPress: vi.fn() });
    // The sentence under the level keeps one full stop.
    expect(row.getAttribute('aria-label')).toBe(
      `Fixture Wren County. County. ${APPROXIMATE} Show Fixture Wren County on the map`,
    );
  });

  it('approximate line', () => {
    const row = draw(STATES.approximate);
    const level = within(row).getByText('County');
    const line = within(row).getByText(APPROXIMATE);
    expect(parseFloat(line.style.fontSize)).toBe(typography.caption.style.fontSize);
    expect(level.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(level.parentElement).toBe(line.parentElement);
    // An exact shape says nothing under its level.
    expect(within(draw(STATES.exact)).queryByText(APPROXIMATE)).toBeNull();
  });

  it('an invalid outline draws nothing', () => {
    const row = draw(STATES.invalidOutline);
    const shapes = squareOf(row).querySelectorAll('svg');
    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.querySelector('path')).toBeNull();
    expect(shapes[0]?.children).toHaveLength(0);
    expect(row.innerHTML).not.toContain('C10 10');
  });

  it('miniMapText', () => {
    const t = getI18n().getFixedT('en') as unknown as TFunction;
    expect(
      miniMapText({ name: 'Fixture Alder', level: 'local', geometryQuality: 'exact' }, t),
    ).toEqual({
      levelLabel: 'Local',
      approximateText: null,
      openLabel: 'Show Fixture Alder on the map',
    });
    for (const [level, label] of [
      ['county', 'County'],
      ['state', 'State'],
      ['federal', 'Federal'],
      ['special', 'Special district'],
    ] as const) {
      expect(
        miniMapText({ name: 'Fixture Alder', level, geometryQuality: 'exact' }, t).levelLabel,
        level,
      ).toBe(label);
    }
    for (const geometryQuality of ['parent_fallback', 'county_approx'] as const) {
      expect(
        miniMapText({ name: 'Fixture Alder', level: 'local', geometryQuality }, t).approximateText,
        geometryQuality,
      ).toBe(APPROXIMATE);
    }
  });
});
