import { describe, expect, it } from 'vitest';
import { shiftForAlaska } from './geometry.ts';
import type { MultiPolygonCoords } from './geometry.ts';
import { OUTLINE_MAX_POINTS, outlineDetail, outlineFor } from './outline.ts';

const PATTERN = /^[MLHVZmlhvz0-9 ,.-]+$/;
const METRES_PER_DEGREE_LAT = 111_320;

/** A square ring in degrees from its south-west corner and its side in degrees. */
function square(lng: number, lat: number, side: number): [number, number][] {
  return [
    [lng, lat],
    [lng + side, lat],
    [lng + side, lat + side],
    [lng, lat + side],
    [lng, lat],
  ];
}

/** A square ring whose side is `metres` long, around a centre in degrees. */
function squareMetres(lng: number, lat: number, metres: number): [number, number][] {
  const dLat = metres / 2 / METRES_PER_DEGREE_LAT;
  const dLng = metres / 2 / (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

/** A closed ring of 5,000 points at 35.8°N, `radius` metres plus `bump(i)` from the centre. */
function circle(radius: number, bump: (i: number) => number): [number, number][] {
  const lat = 35.8;
  const ring: [number, number][] = [];
  for (let i = 0; i < 5000; i += 1) {
    const angle = (2 * Math.PI * i) / 5000;
    const r = radius + bump(i);
    ring.push([
      -78.6 + (r * Math.cos(angle)) / (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180)),
      lat + (r * Math.sin(angle)) / METRES_PER_DEGREE_LAT,
    ]);
  }
  const first = ring[0];
  if (first === undefined) {
    throw new Error('empty ring');
  }
  ring.push(first);
  return ring;
}

function pointCount(svg: string): number {
  return (svg.match(/[ML]/g) ?? []).length;
}

describe('outline', () => {
  it('writes a unit square at the equator as the hand-worked path and box', () => {
    const outline = outlineFor([[square(0, 0, 1)]]);
    // x spans 6378137 × π/180 = 111,319.49 m; y spans 6378137 × ln(tan(45.5°)) = 111,325.14 m,
    // so s = 111.32514 and the east side lands on round(999.949) = 1000.
    expect(outline).toEqual({
      outline_svg: 'M 0 1000 L 1000 1000 L 1000 0 L 0 0 Z',
      outline_bbox: [0, 0, 111319.49, 111325.14],
    });
  });

  it('outline keeps the largest part and drops small islands', () => {
    const coords: MultiPolygonCoords = [
      [squareMetres(-78.6, 35.8, 50)],
      [squareMetres(-78.7, 35.8, 10_000)],
    ];
    const outline = outlineFor(coords);
    expect(outline).not.toBeNull();
    const svg = outline?.outline_svg ?? '';
    expect(svg.match(/M/g)).toHaveLength(1);
    expect(pointCount(svg)).toBe(4);
    // The box is the 10 km square's: about 10 km wide in Web Mercator metres at 35.8°N.
    const [minX, , maxX] = outline?.outline_bbox ?? [0, 0, 0, 0];
    expect(maxX - minX).toBeGreaterThan(12_000);
    expect(maxX - minX).toBeLessThan(12_500);
  });

  it('keeps a hole of at least 1% and drops a smaller one', () => {
    const outer = square(0, 0, 1);
    const bigHole = square(0.1, 0.1, 0.2); // 4% of the outer ring
    const smallHole = square(0.6, 0.6, 0.05); // 0.25%
    const outline = outlineFor([[outer, bigHole, smallHole]]);
    expect(outline?.outline_svg.match(/M/g)).toHaveLength(2);
    expect(outline?.outline_svg).toBe(
      'M 0 1000 L 1000 1000 L 1000 0 L 0 0 Z M 100 900 L 300 900 L 300 700 L 100 700 Z',
    );
  });

  it('a feature over 400 points is simplified until it fits', () => {
    const detail = outlineDetail([[circle(10_000, () => 0)]]);
    expect(detail.points).toBeLessThanOrEqual(OUTLINE_MAX_POINTS);
    expect(Number.isInteger(Math.log2(detail.toleranceM))).toBe(true);
    const svg = detail.outline?.outline_svg ?? '';
    expect(pointCount(svg)).toBeLessThanOrEqual(OUTLINE_MAX_POINTS);
    expect(pointCount(svg)).toBeGreaterThan(100);
    expect(svg).toMatch(PATTERN);
  });

  it('doubles the tolerance past 1 m when the first does not fit', () => {
    // Every other point sits 20 m outside the circle: no tolerance under 20 m drops a point.
    const detail = outlineDetail([[circle(10_000, (i) => (i % 2 === 0 ? 0 : 20))]]);
    expect(detail.points).toBeLessThanOrEqual(OUTLINE_MAX_POINTS);
    expect(detail.toleranceM).toBeGreaterThanOrEqual(32);
    expect(Number.isInteger(Math.log2(detail.toleranceM))).toBe(true);
    expect(pointCount(detail.outline?.outline_svg ?? '')).toBeLessThanOrEqual(OUTLINE_MAX_POINTS);
  });

  it('the outline is deterministic', () => {
    const coords: MultiPolygonCoords = [
      [squareMetres(-78.7, 35.8, 10_000)],
      [square(-78, 36, 0.05)],
    ];
    expect(outlineFor(coords)).toEqual(outlineFor(coords));
    expect(outlineFor(coords)?.outline_svg).toBe(outlineFor(coords)?.outline_svg);
  });

  it('Alaska is shifted before the outline', () => {
    const coords: MultiPolygonCoords = [[square(172, 52, 7)], [square(-179, 52, 5)]];
    const shifted = outlineFor(shiftForAlaska(coords, '02'));
    const unshifted = outlineFor(shiftForAlaska(coords, '99'));
    const width = (o: typeof shifted): number =>
      o === null ? 0 : o.outline_bbox[2] - o.outline_bbox[0];
    // 14 degrees of longitude: 14 × 111,319.49 m.
    expect(width(shifted)).toBeLessThan(2_000_000);
    expect(width(shifted)).toBeCloseTo(1_558_472.87, 0);
    // 358 degrees: the box spans the globe.
    expect(width(unshifted)).toBeGreaterThan(39_000_000);
  });

  it('returns null for a shape with no extent', () => {
    expect(
      outlineFor([
        [
          [
            [1, 1],
            [1, 1],
            [1, 1],
            [1, 1],
          ],
        ],
      ]),
    ).toBeNull();
    expect(outlineFor([])).toBeNull();
  });

  it('writes polygons in descending area', () => {
    const outline = outlineFor([[square(0, 0, 0.5)], [square(1, 0, 1)]]);
    // The box is 2 degrees wide, so s = 222.639 m: the larger square, written first, spans x 500 to
    // 1000 and y 0 to 500; the smaller one x 0 to 250 and y 250 to 500.
    expect(outline?.outline_svg).toBe(
      'M 500 500 L 1000 500 L 1000 0 L 500 0 Z M 0 500 L 250 500 L 250 250 L 0 250 Z',
    );
  });
});
