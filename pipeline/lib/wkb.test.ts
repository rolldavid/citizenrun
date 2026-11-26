import { describe, expect, it } from 'vitest';
import { RingNotClosedError, geomHash, multiPolygonToWkb, pointToWkb, toHex } from './wkb.ts';
import type { Position } from './wkb.ts';

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

// Worked out from the WKB layout by hand: 01 06000000 02000000, then per polygon
// 01 03000000 01000000 05000000 and five points of two little-endian float64s.
const TWO_SQUARES_HEX =
  '0106000000020000000103000000010000000500000000000000000000000000000000000000000000000000f03f0000000000000000000000000000f03f000000000000f03f0000000000000000000000000000f03f00000000000000000000000000000000010300000001000000050000000000000000000040000000000000004000000000000008400000000000000040000000000000084000000000000008400000000000000040000000000000084000000000000000400000000000000040';

describe('wkb', () => {
  it('a two-polygon MultiPolygon equals the hand-written hex', () => {
    const wkb = multiPolygonToWkb(TWO_SQUARES);
    expect(wkb.byteLength).toBe(195);
    expect(toHex(wkb)).toBe(TWO_SQUARES_HEX);
  });

  it('its geom_hash is the SHA-256 of the bytes', () => {
    expect(geomHash(multiPolygonToWkb(TWO_SQUARES))).toBe(
      '3896df0c170c31fb4e945259e01b0c2bdbc7ed19ffffde76c25150db36ebd7dc',
    );
  });

  it('a point equals its hex', () => {
    expect(toHex(pointToWkb([-77.0365, 38.8977]))).toBe(
      '010100000075931804564253c042cf66d5e7724340',
    );
  });

  it('an open ring throws', () => {
    const open: Position[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.5],
    ];
    expect(() => multiPolygonToWkb([[open]])).toThrow(RingNotClosedError);
    expect(() =>
      multiPolygonToWkb([
        [
          [
            [0, 0],
            [1, 0],
            [0, 0],
          ],
        ],
      ]),
    ).toThrow(RingNotClosedError);
  });

  it('writes a polygon with a hole as two rings', () => {
    const hole: Position[] = [
      [0.25, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
      [0.25, 0.25],
    ];
    const outer = TWO_SQUARES[0]?.[0] ?? [];
    const hex = toHex(multiPolygonToWkb([[outer, hole]]));
    // Header, one polygon of two rings: the outer ring's 5 points, then the hole's 4.
    expect(hex.slice(0, 18 + 18)).toBe('010600000001000000010300000002000000');
    expect(hex.length).toBe((9 + 9 + 4 + 5 * 16 + 4 + 4 * 16) * 2);
  });
});
