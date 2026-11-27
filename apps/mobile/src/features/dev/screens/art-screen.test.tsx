import { OFFICE_ART_IDS } from '@citizenrun/cards';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { sessionFake } from '@/test/platform/session';
import { renderWithProviders } from '@/test/render';
import { ISSUE_IDS, color, issue, mapStyle, radius, size } from '@/ui/tokens';

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

/** The six drawn offices, with the line the sheet prints over each. */
const DRAWN = {
  'county-treasurer': 'county-treasurer · crop 80 · spot 8 by 24',
  'school-board': 'school-board · crop 84 · spot 12 by 6',
  'water-district-board': 'water-district-board · crop 80 · spot 10 by 10',
  'city-council': 'city-council · crop 73.5 · spot 14 by 16',
  sheriff: 'sheriff · crop 84 · spot 16 by 7',
  'utility-commission': 'utility-commission · crop 84 · spot 10 by 12',
} as const;
const DRAWN_IDS = Object.keys(DRAWN);
/** The 20 tones a drawing is shown on, in order: the 19 issues, then the neutral tone. */
const TONES = [...ISSUE_IDS, 'neutral'] as const;

/**
 * The page's ids read once. The sheet holds some hundreds of drawings, and a search of the whole
 * page for each of them is most of the time a case would take.
 */
function indexed(): {
  at: (testID: string) => HTMLElement;
  drawingAt: (testID: string) => SVGSVGElement;
  tileAt: (testID: string) => HTMLElement;
} {
  const found = new Map<string, HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>('[data-testid^="art."]')) {
    const testID = element.getAttribute('data-testid') ?? '';
    if (found.has(testID)) {
      throw new Error(`${testID} is on the page twice`);
    }
    found.set(testID, element);
  }
  const at = (testID: string): HTMLElement => {
    const element = found.get(testID);
    if (element === undefined) {
      throw new Error(`nothing on the page has the id ${testID}`);
    }
    return element;
  };
  return {
    at,
    drawingAt: (testID) => {
      const drawings = at(testID).querySelectorAll('svg');
      if (drawings.length !== 1 || drawings[0] === undefined) {
        throw new Error(`${testID} holds ${String(drawings.length)} drawings`);
      }
      return drawings[0];
    },
    tileAt: (testID) => {
      const tile = at(testID).firstElementChild;
      if (!(tile instanceof HTMLElement)) {
        throw new Error(`${testID} holds no tile`);
      }
      return tile;
    },
  };
}

/** The fills a drawing uses, as a sorted list. */
function fillsOf(drawing: SVGSVGElement): string[] {
  const fills = [...drawing.querySelectorAll('[fill]')].map((shape) => shape.getAttribute('fill'));
  return [...new Set(fills.filter((fill): fill is string => fill !== null))].sort();
}

/**
 * Checks the colors of an office drawing: its ink, its tone and its spot are all there, and it
 * holds nothing but those three and the paper of its ground (a drawing may need no paper cut).
 */
function expectRoles(
  drawing: SVGSVGElement,
  roles: { ink: string; paper: string; tone: string; spot: string },
  name: string,
): void {
  const fills = fillsOf(drawing);
  expect(fills, name).toEqual(expect.arrayContaining([roles.ink, roles.tone, roles.spot]));
  expect(
    fills.filter((fill) => !Object.values(roles).includes(fill)),
    name,
  ).toEqual([]);
}

/** The shapes of a drawing with their colors left out, so two drawings compare by outline. */
function outlineOf(drawing: SVGSVGElement): string {
  return [...drawing.querySelectorAll('path, rect, circle')]
    .map((shape) =>
      ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r']
        .map((name) => shape.getAttribute(name) ?? '')
        .join(','),
    )
    .join(' ');
}

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
    const { at, drawingAt, tileAt } = indexed();
    expect(ISSUE_IDS).toHaveLength(19);

    // 57 icons: each issue's, alone, at 16, 20 and 24 points, in the text color.
    const icons = document.querySelectorAll('[data-testid^="art.icon-"]');
    expect(icons).toHaveLength(57);
    for (const id of ISSUE_IDS) {
      for (const [name, points] of ICON_SIZES) {
        const icon = drawingAt(`art.icon-${id}-${name}`);
        expect(icon.getAttribute('width'), `${id} ${name}`).toBe(String(points));
        expect(icon.getAttribute('height'), `${id} ${name}`).toBe(String(points));
        for (const path of icon.querySelectorAll('path')) {
          expect(path.getAttribute('fill'), `${id} ${name}`).toBe(color.light.text);
        }
      }
      // The three sizes of an issue are one drawing.
      const outlines = ICON_SIZES.map(([name]) =>
        [...drawingAt(`art.icon-${id}-${name}`).querySelectorAll('path')]
          .map((path) => path.getAttribute('d'))
          .join(' '),
      );
      expect(new Set(outlines).size, id).toBe(1);
    }
    // No two issues share a drawing.
    const drawn = ISSUE_IDS.map((id) =>
      [...drawingAt(`art.icon-${id}-standard`).querySelectorAll('path')]
        .map((path) => path.getAttribute('d'))
        .join(' '),
    );
    expect(new Set(drawn).size).toBe(19);

    // 19 tiles in the first section: each issue's color with its own icon in it.
    expect(document.querySelectorAll('[data-testid^="art.tile-"]')).toHaveLength(19);
    for (const [index, id] of ISSUE_IDS.entries()) {
      const tile = tileAt(`art.tile-${id}`);
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
      const holder = at(`art.keyline-tile-${id}`);
      const tile = tileAt(`art.keyline-tile-${id}`);
      expect(tile.style.backgroundColor, id).toBe(written(issue[id].light));
      expect(tile.style.borderWidth, id).toBe('1px');
      expect(tile.style.borderColor, id).toBe(written(color.light.rule));
      expect(holder.textContent, id).toBe(id);
      expect(holder.parentElement?.style.backgroundColor, id).toBe(written(color.light.hoverBg));
    }

    // The empty chair, once, at its own size.
    const chair = drawingAt('art.empty-chair');
    expect(chair.getAttribute('width')).toBe(String(size.drawingEmpty));
    expect(document.querySelectorAll('[data-testid="art.empty-chair"]')).toHaveLength(1);

    // Eight wordmark specimens: the name at three cap heights and the two letters, in both tones.
    const marks = document.querySelectorAll(
      '[data-testid^="art.wordmark-"], [data-testid^="art.monogram-"]',
    );
    expect(marks).toHaveLength(8);
    for (const mark of MARKS) {
      const primary = drawingAt(`art.${mark}-primary`);
      const inverse = drawingAt(`art.${mark}-inverse`);
      expect(primary.querySelector('path')?.getAttribute('fill'), mark).toBe(color.light.text);
      expect(inverse.querySelector('path')?.getAttribute('fill'), mark).toBe(
        color.light.inverseText,
      );
      // The inverse marks stand on ink.
      expect(at(`art.${mark}-inverse`).parentElement?.style.backgroundColor, mark).toBe(
        written(color.light.inverseBg),
      );
      expect(at(`art.${mark}-primary`).parentElement?.style.backgroundColor, mark).toBe('');
      // The same drawing in both tones.
      expect(inverse.getAttribute('height'), mark).toBe(primary.getAttribute('height'));
    }
    // The name at 14, 17 and 20 points of cap height, smallest first.
    const heights = MARKS.slice(0, 3).map((mark) =>
      Number(drawingAt(`art.${mark}-primary`).getAttribute('height')),
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
    const { at } = indexed();
    const names = new Set<string>();
    for (const id of ISSUE_IDS) {
      const row = at(`art.issue-${id}`);
      // The id, in the mono face, before the drawings.
      expect(row.textContent.startsWith(id), id).toBe(true);
      const small = at(`art.chip-sm-${id}`);
      const medium = at(`art.chip-md-${id}`);
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
    ).toEqual([
      'Issue icons',
      'Tiles on a hovered ground',
      'Empty chair',
      'Wordmark',
      'Office illustrations',
      'Placeholders',
      'Office glyphs',
    ]);
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

  it('every drawing on every tone and on the poster ground', () => {
    draw();
    press('art.theme-light');
    const light = color.light;
    let { at, drawingAt } = indexed();
    // 240 specimens: each of the six drawings on 20 tones, on paper and on the poster ground.
    expect(document.querySelectorAll('[data-testid^="art.office-"]')).toHaveLength(240);
    expect(
      [...document.querySelectorAll('[data-testid^="art.drawn-"]')].map((block) =>
        (block.getAttribute('data-testid') ?? '').slice('art.drawn-'.length),
      ),
    ).toEqual(DRAWN_IDS);
    let onPoster = 0;
    for (const [id, line] of Object.entries(DRAWN)) {
      // The id, the crop line and the spot, before the specimens.
      expect(at(`art.drawn-${id}`).textContent.startsWith(line), id).toBe(true);
      const paper = at(`art.ground-paper-${id}`);
      const poster = at(`art.ground-poster-${id}`);
      expect(paper.style.backgroundColor, id).toBe(written(light.surface));
      expect(poster.style.backgroundColor, id).toBe(written(light.posterBg));
      expect(paper.querySelectorAll('[data-testid^="art.office-"]'), id).toHaveLength(20);
      onPoster += poster.querySelectorAll('[data-testid^="art.office-"]').length;
      for (const tone of TONES) {
        const name = `${id} on ${tone}`;
        const label = tone === 'neutral' ? 'neutral' : null;
        const onPaper = at(`art.office-${id}-paper-${tone}`);
        const onInk = at(`art.office-${id}-poster-${tone}`);
        expect(paper.contains(onPaper), name).toBe(true);
        expect(poster.contains(onInk), name).toBe(true);
        // An issue color always has its name beside it, and the same name on both grounds.
        expect(onPaper.textContent.length, name).toBeGreaterThan(0);
        expect(onInk.textContent, name).toBe(onPaper.textContent);
        if (label !== null) {
          expect(onPaper.textContent, name).toBe(label);
        }
        const drawnOnPaper = drawingAt(`art.office-${id}-paper-${tone}`);
        const drawnOnInk = drawingAt(`art.office-${id}-poster-${tone}`);
        expect(drawnOnPaper.getAttribute('width'), name).toBe('96');
        expect(drawnOnPaper.getAttribute('height'), name).toBe('96');
        expect(drawnOnInk.getAttribute('width'), name).toBe('96');
        expect(drawnOnPaper.getAttribute('viewBox'), name).toBe('0 0 96 96');
        // The roles of each ground and no other color.
        expectRoles(
          drawnOnPaper,
          {
            ink: light.text,
            paper: light.surface,
            tone: tone === 'neutral' ? light.textSecondary : issue[tone].light,
            spot: light.accent,
          },
          name,
        );
        expectRoles(
          drawnOnInk,
          {
            ink: light.posterText,
            paper: light.posterBg,
            tone: tone === 'neutral' ? light.posterTextSecondary : issue[tone].dark,
            spot: light.accent,
          },
          name,
        );
        // One drawing on every tone and ground.
        expect(outlineOf(drawnOnInk), name).toBe(outlineOf(drawnOnPaper));
        expect(outlineOf(drawnOnPaper), name).toBe(
          outlineOf(drawingAt(`art.office-${id}-paper-neutral`)),
        );
      }
    }
    expect(onPoster).toBe(120);
    // The 19 issue names are 19 different labels.
    expect(
      new Set(ISSUE_IDS.map((issueId) => at(`art.office-sheriff-paper-${issueId}`).textContent))
        .size,
    ).toBe(19);
    // No two of the six share a drawing.
    expect(
      new Set(DRAWN_IDS.map((id) => outlineOf(drawingAt(`art.office-${id}-paper-neutral`)))).size,
    ).toBe(6);

    // In the dark theme the paper tones follow the theme, and the poster keeps the dark values.
    press('art.theme-dark');
    const dark = color.dark;
    ({ at, drawingAt } = indexed());
    expect(at('art.ground-paper-sheriff').style.backgroundColor).toBe(written(dark.surface));
    expect(at('art.ground-poster-sheriff').style.backgroundColor).toBe(written(dark.posterBg));
    expect(fillsOf(drawingAt('art.office-sheriff-paper-schools'))).toEqual(
      [dark.text, dark.surface, dark.accent, issue.schools.dark].sort(),
    );
    expect(fillsOf(drawingAt('art.office-sheriff-poster-schools'))).toEqual(
      [dark.posterText, dark.posterBg, dark.accent, issue.schools.dark].sort(),
    );
    expect(fillsOf(drawingAt('art.office-sheriff-poster-neutral'))).toEqual(
      [dark.posterText, dark.posterBg, dark.accent, dark.posterTextSecondary].sort(),
    );
  });

  it('every placeholder once', () => {
    draw();
    press('art.theme-light');
    const light = color.light;
    const { at, drawingAt } = indexed();
    const specimens = [...document.querySelectorAll('[data-testid^="art.placeholder-"]')];
    expect(specimens).toHaveLength(33);
    const ids = specimens.map((specimen) =>
      (specimen.getAttribute('data-testid') ?? '').slice('art.placeholder-'.length),
    );
    // With the six drawn offices they are the whole set, each once.
    expect([...ids, ...DRAWN_IDS].sort()).toEqual([...OFFICE_ART_IDS].sort());
    for (const id of ids) {
      const label = at(`art.placeholder-${id}`).textContent;
      const relative = DRAWN_IDS.find((drawn) => label === `${id} · copy of ${drawn}`);
      expect(relative, label).toBeDefined();
      const drawing = drawingAt(`art.placeholder-${id}`);
      expect(drawing.getAttribute('width'), id).toBe('96');
      // Handed an issue tone, it still draws grey: the relative's drawing in the neutral tone.
      expectRoles(
        drawing,
        { ink: light.text, paper: light.surface, tone: light.textSecondary, spot: light.accent },
        id,
      );
      expect(fillsOf(drawing), id).not.toContain(issue['property-taxes'].light);
      expect(outlineOf(drawing), id).toBe(
        outlineOf(drawingAt(`art.office-${relative ?? ''}-paper-neutral`)),
      );
    }
    // The patrol car stands in for nothing.
    expect(
      specimens.filter((specimen) => specimen.textContent.endsWith('copy of sheriff')),
    ).toHaveLength(0);
  });

  it('every glyph as a tile and two pins', () => {
    draw();
    press('art.theme-light');
    const light = color.light;
    const { at, drawingAt } = indexed();
    expect(OFFICE_ART_IDS).toHaveLength(39);
    expect(document.querySelectorAll('[data-testid^="art.glyph-tile-"]')).toHaveLength(39);
    expect(document.querySelectorAll('[data-testid^="art.pin-large-"]')).toHaveLength(39);
    expect(document.querySelectorAll('[data-testid^="art.pin-medium-"]')).toHaveLength(39);
    const drawn: string[] = [];
    for (const id of OFFICE_ART_IDS) {
      const row = at(`art.glyph-row-${id}`);
      expect(row.textContent, id).toBe(id);
      // The tile as an office tile of a row: a 36 point ink square holding the glyph at 22.
      const tile = at(`art.glyph-tile-${id}`);
      expect(tile.style.width, id).toBe(`${String(size.officeTile.md)}px`);
      expect(tile.style.height, id).toBe('36px');
      expect(tile.style.borderRadius, id).toBe(`${String(radius.control)}px`);
      expect(tile.style.backgroundColor, id).toBe(written(light.inverseBg));
      const onTile = drawingAt(`art.glyph-tile-${id}`);
      expect(onTile.getAttribute('width'), id).toBe('22');
      expect(fillsOf(onTile), id).toEqual([light.inverseText]);
      // The two pins: an ink disc of 36 or 28 inside its keyline, the glyph at 60% of the disc.
      for (const [name, disc, glyph] of [
        ['large', 36, '22'],
        ['medium', 28, '17'],
      ] as const) {
        const pin = at(`art.pin-${name}-${id}`);
        expect(row.contains(pin), id).toBe(true);
        expect(size.pin[name], name).toBe(disc);
        expect(pin.style.width, `${id} ${name}`).toBe(`${String(disc + 3)}px`);
        expect(pin.style.height, `${id} ${name}`).toBe(`${String(disc + 3)}px`);
        expect(pin.style.borderWidth, `${id} ${name}`).toBe(`${String(mapStyle.pinKeyline)}px`);
        expect(pin.style.borderColor, `${id} ${name}`).toBe(written(light.pinKeyline));
        expect(pin.style.backgroundColor, `${id} ${name}`).toBe(written(light.pinBg));
        expect(pin.style.borderRadius, `${id} ${name}`).toBe(`${String(radius.full)}px`);
        const onPin = drawingAt(`art.pin-${name}-${id}`);
        expect(onPin.getAttribute('width'), `${id} ${name}`).toBe(glyph);
        expect(onPin.getAttribute('viewBox'), `${id} ${name}`).toBe('0 0 24 24');
        expect(fillsOf(onPin), `${id} ${name}`).toEqual([light.pinGlyph]);
        // The same glyph on the tile and on both pins.
        expect(outlineOf(onPin), `${id} ${name}`).toBe(outlineOf(onTile));
      }
      drawn.push(outlineOf(onTile));
    }
    // Six glyphs are drawn; every other id shows a copy of one of them.
    expect(new Set(drawn).size).toBe(6);
    expect(new Set(DRAWN_IDS.map((id) => drawn[OFFICE_ART_IDS.indexOf(id as never)])).size).toBe(6);
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
