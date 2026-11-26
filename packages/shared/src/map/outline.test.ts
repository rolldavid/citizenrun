import { describe, expect, it } from 'vitest';
import { outlineBoxArea, outlineToGeoJson, outlineViewBox, parseOutline } from './outline.ts';
import type { Outline } from './outline.ts';

function expectPoints(
  actual: readonly (readonly [number, number])[],
  expected: readonly (readonly [number, number])[],
  tolerance: number,
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([lng, lat], index) => {
    const [wantLng, wantLat] = expected[index] ?? [Number.NaN, Number.NaN];
    expect(Math.abs(lng - wantLng), `point ${String(index)} lng`).toBeLessThan(tolerance);
    expect(Math.abs(lat - wantLat), `point ${String(index)} lat`).toBeLessThan(tolerance);
  });
}

describe('outline', () => {
  it('a rectangle round-trips', () => {
    const outline: Outline = { svg: 'M0 0 L1000 0 L1000 500 L0 500 Z', bbox: [0, 0, 2000, 1000] };
    expect(outlineViewBox(outline.bbox)).toEqual({ width: 1000, height: 500 });
    expect(parseOutline(outline.svg)).toEqual([
      [
        [0, 0],
        [1000, 0],
        [1000, 500],
        [0, 500],
      ],
    ]);
    const geo = outlineToGeoJson(outline);
    expect(geo?.type).toBe('MultiLineString');
    expect(geo?.coordinates).toHaveLength(1);
    expectPoints(
      geo?.coordinates[0] ?? [],
      [
        [0, 0.008983152804391995],
        [0.017966305682390427, 0.008983152804391995],
        [0.017966305682390427, 0],
        [0, 0],
        [0, 0.008983152804391995],
      ],
      1e-6,
    );
  });

  it('two subpaths give two rings', () => {
    const rings = parseOutline('M0 0 L10 0 L10 10 Z M20 20 L30 20 L30 30 Z');
    expect(rings).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      [
        [20, 20],
        [30, 20],
        [30, 30],
      ],
    ]);
  });

  it('a new M closes the ring before it', () => {
    expect(parseOutline('M0 0 L10,0 10,10 M20 20 L30 20 30 30 Z')).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      [
        [20, 20],
        [30, 20],
        [30, 30],
      ],
    ]);
    expect(parseOutline('M-5 -5 L5 -5 L5 5')).toEqual([
      [
        [-5, -5],
        [5, -5],
        [5, 5],
      ],
    ]);
  });

  it('refuses what the pipeline never writes', () => {
    const refused = [
      'M0 0 C10 10 20 20 30 30 Z',
      'M0.5 0 L10 0 Z',
      'M0 0 l10 0 Z',
      'M0 0 Q10 10 20 0 Z',
      '',
      'L0 0 L10 0 Z',
      'M0 L10 0 Z',
      'M0 0 L Z',
      'M0 0 L10 0 10 Z',
      'M0 0 5 5 L10 0 Z',
      'Z',
      'M0 0 L10 0 Z Z',
      'M0 0 L10-5 Z',
      'M0 0 L10 --5 Z',
      ' ',
      '<path d="M0 0"/>',
    ];
    for (const svg of refused) {
      expect(parseOutline(svg), svg).toBeNull();
      expect(outlineToGeoJson({ svg, bbox: [0, 0, 1000, 1000] }), svg).toBeNull();
    }
  });

  it("a box at the District's latitude", () => {
    const outline: Outline = {
      svg: 'M0 0 L750 0 L750 1000 L0 1000 Z',
      bbox: [-8584000, 4689000, -8560000, 4721000],
    };
    expect(outlineViewBox(outline.bbox)).toEqual({ width: 750, height: 1000 });
    const ring = outlineToGeoJson(outline)?.coordinates[0] ?? [];
    expect(ring).toHaveLength(5);
    const lngs = ring.map(([lng]) => lng);
    const lats = ring.map(([, lat]) => lat);
    const near = (actual: number, expected: number): void => {
      expect(Math.abs(actual - expected)).toBeLessThan(1e-4);
    };
    near(Math.min(...lngs), -77.11138398881972);
    near(Math.max(...lngs), -76.89578832063104);
    near(Math.min(...lats), 38.77154510529868);
    near(Math.max(...lats), 38.99531144810143);
  });

  it('box area', () => {
    expect(outlineBoxArea([-8584000, 4689000, -8560000, 4721000])).toBe(768_000_000);
  });

  it('a view box never has a side under 1', () => {
    expect(outlineViewBox([0, 0, 100000, 10])).toEqual({ width: 1000, height: 1 });
    expect(outlineViewBox([5, 5, 5, 5])).toEqual({ width: 1, height: 1 });
  });
});
