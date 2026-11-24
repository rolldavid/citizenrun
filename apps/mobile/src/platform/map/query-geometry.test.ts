import { describe, expect, it } from 'vitest';

import { centrePoint, featureFacts, queryArea } from './query-geometry';

describe('queryArea', () => {
  it('a point query with no radius is the point', () => {
    expect(queryArea({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
  });

  it('a negative radius is the point too', () => {
    expect(queryArea({ x: 10, y: 20 }, -4)).toEqual({ x: 10, y: 20 });
  });

  it('a radius gives a square', () => {
    expect(queryArea({ x: 100, y: 50 }, 22)).toEqual([
      { x: 78, y: 28 },
      { x: 122, y: 72 },
    ]);
  });
});

describe('centrePoint', () => {
  it('the centre of a surface', () => {
    expect(centrePoint({ width: 390, height: 600 })).toEqual({ x: 195, y: 300 });
  });
});

describe('featureFacts', () => {
  it('a point feature has a point and no bounds', () => {
    expect(featureFacts({ type: 'Point', coordinates: [-79.45, 36.03] })).toEqual({
      point: [-79.45, 36.03],
      bounds: null,
    });
  });

  it('lines and polygons have bounds', () => {
    expect(
      featureFacts({
        type: 'LineString',
        coordinates: [
          [-80, 35],
          [-79, 36],
        ],
      }),
    ).toEqual({ point: null, bounds: [-80, 35, -79, 36] });

    expect(
      featureFacts({
        type: 'MultiLineString',
        coordinates: [
          [
            [-80, 35],
            [-79, 36],
          ],
          [
            [-82, 34.5],
            [-81, 37],
          ],
        ],
      }),
    ).toEqual({ point: null, bounds: [-82, 34.5, -79, 37] });

    expect(
      featureFacts({
        type: 'Polygon',
        coordinates: [
          [
            [-78, 35],
            [-77, 35],
            [-77, 36.5],
            [-78, 36.5],
            [-78, 35],
          ],
        ],
      }),
    ).toEqual({ point: null, bounds: [-78, 35, -77, 36.5] });
  });

  it('points of a multi-point and parts of a multi-polygon are all counted', () => {
    expect(
      featureFacts({
        type: 'MultiPoint',
        coordinates: [
          [-80, 35],
          [-70, 40],
        ],
      }),
    ).toEqual({ point: null, bounds: [-80, 35, -70, 40] });

    expect(
      featureFacts({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-100, 30],
              [-99, 30],
              [-99, 31],
              [-100, 30],
            ],
          ],
          [
            [
              [-90, 40],
              [-89, 40],
              [-89, 41],
              [-90, 40],
            ],
          ],
        ],
      }),
    ).toEqual({ point: null, bounds: [-100, 30, -89, 41] });
  });

  it('nothing usable gives nothing', () => {
    const nothing = { point: null, bounds: null };
    expect(featureFacts(null)).toEqual(nothing);
    expect(featureFacts(undefined)).toEqual(nothing);
    expect(featureFacts({ type: 'GeometryCollection' })).toEqual(nothing);
    expect(featureFacts({ type: 'LineString', coordinates: [] })).toEqual(nothing);
    expect(featureFacts({ type: 'Point', coordinates: [Number.NaN, 1] })).toEqual(nothing);
    expect(
      featureFacts({
        type: 'LineString',
        coordinates: [
          [-80, 35],
          [Number.POSITIVE_INFINITY, 36],
        ],
      }),
    ).toEqual(nothing);
    expect(featureFacts({ type: 'Polygon' })).toEqual(nothing);
  });
});
