import { describe, expect, it } from 'vitest';
import { multiPolygonToWkb, toHex } from '../../lib/wkb.ts';
import type { Position } from '../../lib/wkb.ts';
import {
  assignZctas,
  multiPolygonFromWkbHex,
  pointInMultiPolygon,
  stateGeometryRow,
  stateShape,
} from './zip-centroids.ts';
import type { StateShape } from './zip-centroids.ts';

const square = (x0: number, y0: number, x1: number, y1: number): Position[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

function shape(state: string, rings: Position[][]): StateShape {
  const made = stateShape(state, toHex(multiPolygonToWkb([rings])));
  if (made === null) throw new Error('no shape');
  return made;
}

const zcta = (zip: string, lng: number, lat: number) => ({
  ZCTA5CE20: zip,
  INTPTLAT20: lat >= 0 ? `+${String(lat)}` : String(lat),
  INTPTLON20: lng >= 0 ? `+${String(lng)}` : String(lng),
});

describe('ZIP centroids', () => {
  // A made-up state ZZ: land from 0 to 10 with a lake hole from 4 to 6; its lookup geometry
  // reaches 2 units offshore. A made-up neighbour YY's lookup geometry overlaps ZZ's land.
  const display = [shape('ZZ', [square(0, 0, 10, 10), square(4, 4, 6, 6)])];
  const lookup = [shape('YY', [square(8, 0, 20, 10)]), shape('ZZ', [square(-2, -2, 12, 12)])];

  it('a point inside a made-up state land geometry takes that state', () => {
    const { rows, unassigned } = assignZctas([zcta('99001', 9, 5)], display, lookup);
    expect(rows).toEqual([{ source_key: 'zcta:99001', zip: '99001', state: 'ZZ', lng: 9, lat: 5 }]);
    expect(unassigned).toBe(0);
  });

  it('a point offshore inside its lookup geometry takes it too', () => {
    const { rows } = assignZctas([zcta('99002', -1, 5)], display, lookup);
    expect(rows.map((row) => row.state)).toEqual(['ZZ']);
  });

  it('a point covered by neither is skipped and counted', () => {
    const { rows, unassigned } = assignZctas(
      [zcta('99004', 50, 50), zcta('99003', 1, 1)],
      display,
      lookup,
    );
    expect(rows.map((row) => row.source_key)).toEqual(['zcta:99003']);
    expect(unassigned).toBe(1);
  });

  it('a hole in the land is not land', () => {
    expect(pointInMultiPolygon([5, 5], display[0]?.coords ?? [])).toBe(false);
    // In the lake: ZZ's land does not cover it, so the first lookup geometry that does, YY's
    // does not reach it and ZZ's does.
    const { rows } = assignZctas([zcta('99005', 5, 5)], display, lookup);
    expect(rows.map((row) => row.state)).toEqual(['ZZ']);
  });

  it('reads back the WKB the pipeline writes', () => {
    const rings = [square(0, 0, 1, 1)];
    expect(multiPolygonFromWkbHex(toHex(multiPolygonToWkb([rings, [square(2, 2, 3, 3)]])))).toEqual(
      [rings, [square(2, 2, 3, 3)]],
    );
  });

  it('finds the state row among the geometry rows', async () => {
    async function* rows() {
      await Promise.resolve();
      yield { source_key: 'tiger:county:99001', display_wkb: 'aa', lookup_wkb: 'bb' };
      yield { source_key: 'tiger:state:99', display_wkb: 'cc', lookup_wkb: 'dd' };
    }
    await expect(stateGeometryRow(rows(), '99')).resolves.toEqual({
      display_wkb: 'cc',
      lookup_wkb: 'dd',
    });
  });
});
