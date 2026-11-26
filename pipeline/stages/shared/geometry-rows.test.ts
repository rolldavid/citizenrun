import { createHash } from 'node:crypto';
import { BGeometrySchema } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { multiPolygonToWkb, toHex } from '../../lib/wkb.ts';
import type { Position } from '../../lib/wkb.ts';
import { fallbackGeomHash } from '../base/geometry.ts';
import {
  GeometryInputMissing,
  WkbDecodeError,
  decodeMultiPolygonHex,
  fallbackRow,
  unionRow,
} from './geometry-rows.ts';

// The two unit squares of the WKB writer's test.
const TWO_SQUARES: Position[][][] = [
  [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
  [
    [
      [2, 2],
      [3, 2],
      [3, 3],
      [2, 3],
      [2, 2],
    ],
  ],
];

function square(x: number, y: number): Position[][][] {
  return [
    [
      [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
        [x, y],
      ],
    ],
  ];
}

describe('decodeMultiPolygonHex', () => {
  it('gives back the two-polygon vector the writer wrote', () => {
    expect(decodeMultiPolygonHex(toHex(multiPolygonToWkb(TWO_SQUARES)))).toEqual(TWO_SQUARES);
  });

  it('reads a Polygon as one polygon', () => {
    const hex = toHex(multiPolygonToWkb(TWO_SQUARES)).slice(18);
    const firstPolygon = hex.slice(0, (9 + 4 + 5 * 16) * 2);
    expect(decodeMultiPolygonHex(firstPolygon)).toEqual([TWO_SQUARES[0]]);
  });

  it('refuses a big-endian buffer', () => {
    const hex = toHex(multiPolygonToWkb(TWO_SQUARES));
    expect(() => decodeMultiPolygonHex(`00${hex.slice(2)}`)).toThrow(WkbDecodeError);
  });

  it('refuses a truncated buffer, another type and trailing bytes', () => {
    const hex = toHex(multiPolygonToWkb(TWO_SQUARES));
    expect(() => decodeMultiPolygonHex(hex.slice(0, -2))).toThrow(WkbDecodeError);
    expect(() => decodeMultiPolygonHex('0101000000000000000000f03f000000000000f03f')).toThrow(
      WkbDecodeError,
    );
    expect(() => decodeMultiPolygonHex(`${hex}00`)).toThrow(WkbDecodeError);
  });
});

const viaRow = BGeometrySchema.parse({
  source_key: 'tiger:county:99001',
  lookup_wkb: toHex(multiPolygonToWkb(square(0, 0))),
  display_wkb: toHex(multiPolygonToWkb(square(0, 0))),
  label_point: [0.5, 0.5],
  outline_svg: 'M 0 0 L 1 0 L 1 1 Z',
  outline_bbox: [0, 0, 1, 1],
  geom_hash: 'a'.repeat(64),
});

describe('fallbackRow', () => {
  it('over one via row copies its outline, box and label point', async () => {
    const row = await fallbackRow('parent_fallback:county:ZZ:99001:district-1', [viaRow]);
    expect(row).toEqual({
      source_key: 'parent_fallback:county:ZZ:99001:district-1',
      lookup_wkb: null,
      display_wkb: null,
      label_point: [0.5, 0.5],
      outline_svg: 'M 0 0 L 1 0 L 1 1 Z',
      outline_bbox: [0, 0, 1, 1],
      geom_hash: fallbackGeomHash(['tiger:county:99001']),
    });
  });

  it('refuses a via row without display WKB', async () => {
    await expect(fallbackRow('k', [{ ...viaRow, display_wkb: null }])).rejects.toBeInstanceOf(
      GeometryInputMissing,
    );
  });
});

describe('unionRow', () => {
  it('two adjacent squares give an exact row hashed by its lookup WKB', async () => {
    const east = {
      ...viaRow,
      source_key: 'tiger:county:99003',
      lookup_wkb: toHex(multiPolygonToWkb(square(1, 0))),
      display_wkb: null,
    };
    const row = await unionRow('county_union:ZZ:east', [viaRow, east], '99');
    expect(row.source_key).toBe('county_union:ZZ:east');
    expect(row.lookup_wkb).not.toBeNull();
    expect(row.display_wkb).not.toBeNull();
    const lookup = Buffer.from(row.lookup_wkb ?? '', 'hex');
    expect(row.geom_hash).toBe(createHash('sha256').update(lookup).digest('hex'));
    // One polygon of one ring.
    expect(row.lookup_wkb?.slice(0, 36)).toBe('010600000001000000010300000001000000');
  });

  it('refuses a county row without lookup WKB', async () => {
    await expect(unionRow('k', [{ ...viaRow, lookup_wkb: null }], '99')).rejects.toBeInstanceOf(
      GeometryInputMissing,
    );
  });
});
