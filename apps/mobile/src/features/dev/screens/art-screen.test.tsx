import { cleanup, fireEvent, screen } from '@testing-library/react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';
import { renderWithProviders } from '@/test/render';
import { ISSUE_IDS, color, issue, size } from '@/ui/tokens';

import { ArtScreen } from './art-screen';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A drawing of the sheet loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing loads no asset');
  },
}));

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const ICON_SIZES = [
  ['small', 16],
  ['medium', 20],
  ['standard', 24],
] as const;
const MARKS = ['wordmark-minimum', 'wordmark-app-bar', 'wordmark-rail', 'monogram-rail'] as const;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders the sheet, in place of whatever was drawn before. */
function draw(): void {
  cleanup();
  renderWithProviders(<ArtScreen />);
}

function press(testID: string): void {
  fireEvent.click(screen.getByTestId(testID));
}

/** The drawing under an id: the one svg it holds. */
function drawingOf(testID: string): SVGSVGElement {
  const drawings = screen.getByTestId(testID).querySelectorAll('svg');
  if (drawings.length !== 1 || drawings[0] === undefined) {
    throw new Error(`${testID} holds ${String(drawings.length)} drawings`);
  }
  return drawings[0];
}

/** The square a tile draws under an id. */
function tileOf(testID: string): HTMLElement {
  const tile = screen.getByTestId(testID).firstElementChild;
  if (!(tile instanceof HTMLElement)) {
    throw new Error(`${testID} holds no tile`);
  }
  return tile;
}

/** The fill of a control button's own box. */
function fillOf(testID: string): string {
  const box = screen.getByTestId(testID).querySelector<HTMLElement>('[style*="min-height"]');
  if (box === null) {
    throw new Error(`the button ${testID} has no box`);
  }
  return box.style.backgroundColor;
}

/** The ground the sheet paints behind everything: the view its own theme provider draws. */
function ground(): string {
  const root = screen.getByTestId('art.scroll').parentElement;
  if (root === null) {
    throw new Error('the sheet has no ground');
  }
  return window.getComputedStyle(root).backgroundColor;
}

describe('ArtScreen', () => {
  it('every issue icon at three sizes', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    draw();
    press('art.theme-light');
    expect(ISSUE_IDS).toHaveLength(19);

    // 57 icons: each issue's, alone, at 16, 20 and 24 points, in the text color.
    const icons = document.querySelectorAll('[data-testid^="art.icon-"]');
    expect(icons).toHaveLength(57);
    for (const id of ISSUE_IDS) {
      for (const [name, points] of ICON_SIZES) {
        const icon = drawingOf(`art.icon-${id}-${name}`);
        expect(icon.getAttribute('width'), `${id} ${name}`).toBe(String(points));
        expect(icon.getAttribute('height'), `${id} ${name}`).toBe(String(points));
        for (const path of icon.querySelectorAll('path')) {
          expect(path.getAttribute('fill'), `${id} ${name}`).toBe(color.light.text);
        }
      }
      // The three sizes of an issue are one drawing.
      const outlines = ICON_SIZES.map(([name]) =>
        [...drawingOf(`art.icon-${id}-${name}`).querySelectorAll('path')]
          .map((path) => path.getAttribute('d'))
          .join(' '),
      );
      expect(new Set(outlines).size, id).toBe(1);
    }
    // No two issues share a drawing.
    const drawn = ISSUE_IDS.map((id) =>
      [...drawingOf(`art.icon-${id}-standard`).querySelectorAll('path')]
        .map((path) => path.getAttribute('d'))
        .join(' '),
    );
    expect(new Set(drawn).size).toBe(19);

    // 19 tiles in the first section: each issue's color with its own icon in it.
    expect(document.querySelectorAll('[data-testid^="art.tile-"]')).toHaveLength(19);
    for (const [index, id] of ISSUE_IDS.entries()) {
      const tile = tileOf(`art.tile-${id}`);
      expect(tile.style.width, id).toBe('28px');
      expect(tile.style.backgroundColor, id).toBe(written(issue[id].light));
      expect(tile.style.borderWidth, id).toBe('');
      const glyph = [...tile.querySelectorAll('path')];
      expect(glyph.map((path) => path.getAttribute('d')).join(' '), id).toBe(drawn[index]);
      for (const path of glyph) {
        expect(path.getAttribute('fill'), id).toBe(issue[id].on);
      }
    }

    // 19 keylined tiles on the hover fill, each with its id beside it.
    const keylined = document.querySelectorAll<HTMLElement>('[data-testid^="art.keyline-tile-"]');
    expect(keylined).toHaveLength(19);
    for (const id of ISSUE_IDS) {
      const holder = screen.getByTestId(`art.keyline-tile-${id}`);
      const tile = tileOf(`art.keyline-tile-${id}`);
      expect(tile.style.backgroundColor, id).toBe(written(issue[id].light));
      expect(tile.style.borderWidth, id).toBe('1px');
      expect(tile.style.borderColor, id).toBe(written(color.light.rule));
      expect(holder.textContent, id).toBe(id);
      expect(holder.parentElement?.style.backgroundColor, id).toBe(written(color.light.hoverBg));
    }

    // The empty chair, once, at its own size.
    const chair = drawingOf('art.empty-chair');
    expect(chair.getAttribute('width')).toBe(String(size.drawingEmpty));
    expect(document.querySelectorAll('[data-testid="art.empty-chair"]')).toHaveLength(1);

    // Eight wordmark specimens: the name at three cap heights and the two letters, in both tones.
    const marks = document.querySelectorAll(
      '[data-testid^="art.wordmark-"], [data-testid^="art.monogram-"]',
    );
    expect(marks).toHaveLength(8);
    for (const mark of MARKS) {
      const primary = drawingOf(`art.${mark}-primary`);
      const inverse = drawingOf(`art.${mark}-inverse`);
      expect(primary.querySelector('path')?.getAttribute('fill'), mark).toBe(color.light.text);
      expect(inverse.querySelector('path')?.getAttribute('fill'), mark).toBe(
        color.light.inverseText,
      );
      // The inverse marks stand on ink.
      expect(
        screen.getByTestId(`art.${mark}-inverse`).parentElement?.style.backgroundColor,
        mark,
      ).toBe(written(color.light.inverseBg));
      expect(
        screen.getByTestId(`art.${mark}-primary`).parentElement?.style.backgroundColor,
        mark,
      ).toBe('');
      // The same drawing in both tones.
      expect(inverse.getAttribute('height'), mark).toBe(primary.getAttribute('height'));
    }
    // The name at 14, 17 and 20 points of cap height, smallest first.
    const heights = MARKS.slice(0, 3).map((mark) =>
      Number(drawingOf(`art.${mark}-primary`).getAttribute('height')),
    );
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
    expect(new Set(heights).size).toBe(3);

    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('each issue has its id, and its chip at both sizes with a short name', () => {
    draw();
    const names = new Set<string>();
    for (const id of ISSUE_IDS) {
      const row = screen.getByTestId(`art.issue-${id}`);
      // The id, in the mono face, before the drawings.
      expect(row.textContent.startsWith(id), id).toBe(true);
      const small = screen.getByTestId(`art.chip-sm-${id}`);
      const medium = screen.getByTestId(`art.chip-md-${id}`);
      expect(row.contains(small), id).toBe(true);
      expect(row.contains(medium), id).toBe(true);
      expect(small.style.minHeight, id).toBe('32px');
      expect(medium.style.minHeight, id).toBe('44px');
      // Both print the same short name, and neither is a control.
      expect(small.textContent, id).toBe(medium.textContent);
      expect(small.textContent.length, id).toBeGreaterThan(0);
      expect(small.textContent.length, id).toBeLessThanOrEqual(20);
      names.add(small.textContent);
      for (const chip of [small, medium]) {
        expect(chip.getAttribute('role'), id).toBeNull();
        expect(chip.querySelectorAll('[role], [tabindex]'), id).toHaveLength(0);
      }
    }
    expect(names.size).toBe(19);
    // The issues stand in their order.
    const rows = [...document.querySelectorAll('[data-testid^="art.issue-"]')].map((row) =>
      (row.getAttribute('data-testid') ?? '').slice('art.issue-'.length),
    );
    expect(rows).toEqual([...ISSUE_IDS]);
  });

  it('has a heading for the page and one for each section', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1, name: 'Art' })).toBeDefined();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Issue icons', 'Tiles on a hovered ground', 'Empty chair', 'Wordmark']);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    // The only targets are the two controls, and each carries an id.
    const targets = document.querySelectorAll('a, button, [role="button"], [role="checkbox"]');
    expect(targets).toHaveLength(5);
    for (const target of targets) {
      expect(target.getAttribute('data-testid') ?? '').toMatch(TEST_ID);
    }
  });

  it('opens in the system theme, and the theme control switches it', () => {
    draw();
    // The chosen value is the ink button; the others are outlines with no fill.
    expect(fillOf('art.theme-system')).not.toBe('');
    expect(fillOf('art.theme-light')).toBe('');
    expect(fillOf('art.theme-dark')).toBe('');
    press('art.theme-dark');
    expect(ground()).toBe(written(color.dark.bg));
    expect(fillOf('art.theme-dark')).toBe(written(color.dark.inverseBg));
    expect(fillOf('art.theme-system')).toBe('');
    // The drawings follow: an icon alone in the dark theme's text color, a tile in its dark fill.
    expect(
      drawingOf('art.icon-rent-housing-standard').querySelector('path')?.getAttribute('fill'),
    ).toBe(color.dark.text);
    expect(tileOf('art.tile-rent-housing').style.backgroundColor).toBe(
      written(issue['rent-housing'].dark),
    );
    expect(
      screen.getByTestId('art.keyline-tile-rent-housing').parentElement?.style.backgroundColor,
    ).toBe(written(color.dark.hoverBg));
    expect(tileOf('art.keyline-tile-rent-housing').style.borderColor).toBe(
      written(color.dark.rule),
    );
    press('art.theme-light');
    expect(ground()).toBe(written(color.light.bg));
    expect(tileOf('art.tile-rent-housing').style.backgroundColor).toBe(
      written(issue['rent-housing'].light),
    );
  });

  it('the text control scales the words and never a drawing', () => {
    draw();
    const heading = screen.getByRole('heading', { level: 1, name: 'Art' });
    const before = parseFloat(heading.style.fontSize);
    press('art.text-130');
    expect(parseFloat(heading.style.fontSize)).toBeCloseTo(before * 1.3);
    expect(drawingOf('art.icon-rent-housing-small').getAttribute('width')).toBe('16');
    expect(tileOf('art.tile-rent-housing').style.width).toBe('28px');
    expect(drawingOf('art.empty-chair').getAttribute('width')).toBe(String(size.drawingEmpty));
    press('art.text-100');
    expect(parseFloat(heading.style.fontSize)).toBeCloseTo(before);
  });

  it('keeps its heading clear of the status bar', () => {
    cleanup();
    renderWithProviders(
      <SafeAreaInsetsContext.Provider value={{ top: 47, right: 0, bottom: 34, left: 0 }}>
        <ArtScreen />
      </SafeAreaInsetsContext.Provider>,
    );
    const inset = screen.getByTestId('art.scroll').previousElementSibling;
    expect(inset instanceof HTMLElement ? inset.style.height : '').toBe('47px');
  });

  it('the sheet sends nothing', () => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    draw();
    press('art.theme-dark');
    press('art.text-130');
    expect(fetched).not.toHaveBeenCalled();
    expect(sessionFake.calls).toEqual([]);
    // The one call is the key subscription of the shortcut provider the test renders around the screen.
    expect(linksFake.calls).toEqual([{ op: 'subscribeKeyDown' }]);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    fetched.mockRestore();
  });
});
