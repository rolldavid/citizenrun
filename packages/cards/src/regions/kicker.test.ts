import { beforeAll, describe, expect, it } from 'vitest';
import { G, Rect } from '@citizenrun/cards/primitives';
import { CANVAS } from '../canvas.ts';
import { measureText, setStrictGlyphs } from '../layout-text.ts';
import { KickerRegion, layoutKicker } from './kicker.tsx';
import { COLORS, MONO } from './testing/support.ts';
import { draw, lineWith, linesOf, walk } from './testing/tree.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

const ISSUE = { issueId: 'property-taxes', label: 'Property taxes' };
const LEVEL = { issueId: null, label: 'County office' };

describe('the kicker', () => {
  it('tile or no tile', () => {
    const tiled = draw(KickerRegion({ model: ISSUE, colors: COLORS, ground: 'paper' }));
    expect(tiled.map((node) => node.type)).toEqual([Rect, G, tiled[2]?.type]);
    expect(tiled[0]?.props).toEqual({ x: 66, y: 66, width: 56, height: 56, fill: 'c-issue-fill' });
    expect(String(tiled[1]?.props.transform).startsWith('translate(75 75) ')).toBe(true);
    // The icon takes the one color that reads on the tile.
    const inks = walk(tiled[1]?.children ?? []).flatMap((part) =>
      [part.props.fill, part.props.stroke].filter((ink) => ink !== undefined && ink !== 'none'),
    );
    expect(new Set(inks)).toEqual(new Set(['c-issue-on']));
    expect(lineWith(tiled, 'PROPERTY TAXES').props).toEqual({
      x: 140,
      y: 108,
      ...MONO,
      fontSize: 40,
      fill: 'c-text',
    });

    const plain = draw(KickerRegion({ model: LEVEL, colors: COLORS, ground: 'paper' }));
    expect(plain).toHaveLength(1);
    expect(lineWith(plain, 'COUNTY OFFICE').props).toMatchObject({ x: 66, y: 108 });

    // The label is measured with the tracking of capitals, which is wider than without.
    const label = layoutKicker(ISSUE, true).label;
    expect(label.width).toBe(
      measureText('PROPERTY TAXES', {
        face: 'mono',
        size: CANVAS.type.mono,
        tracking: CANVAS.track.caps,
      }),
    );
    expect(label.width).toBeGreaterThan(
      measureText('PROPERTY TAXES', { face: 'mono', size: CANVAS.type.mono }),
    );
  });

  it('draws no tile for an issue the colors do not hold', () => {
    const drawn = draw(
      KickerRegion({
        model: { issueId: 'public-money', label: 'Public money' },
        colors: COLORS,
        ground: 'paper',
      }),
    );
    expect(drawn).toHaveLength(1);
    expect(lineWith(drawn, 'PUBLIC MONEY').props).toMatchObject({ x: 66 });
  });

  it('takes the poster values on a poster', () => {
    const drawn = draw(KickerRegion({ model: ISSUE, colors: COLORS, ground: 'poster' }));
    expect(drawn[0]?.props.fill).toBe('c-issue-poster');
    expect(linesOf(drawn).map((line) => line.props.fill)).toEqual(['c-poster-text']);
  });

  it('cuts a label that runs past the margin', () => {
    const long = layoutKicker(
      { issueId: null, label: 'Fixture label that is far too long for one row of a canvas' },
      false,
    );
    expect(long.label.cut).toBe(true);
    expect(long.label.text.endsWith('…')).toBe(true);
    expect(long.label.width).toBeLessThanOrEqual(CANVAS.measure);
  });
});
