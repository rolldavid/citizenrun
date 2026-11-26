// ZIP centroids (D-209, D-212): each ZCTA's internal point, assigned to the state whose
// land-clipped geometry covers it, else the state whose lookup geometry covers it.
import { BZipCentroidSchema } from '@citizenrun/shared';
import type { BGeometry, BZipCentroid } from '@citizenrun/shared';
import type { DbfRow } from '../../sources/tiger.ts';
import type { MultiPolygonCoords } from './geometry.ts';

type Position = readonly [number, number];

/** A WKB value that is not a MultiPolygon of 2D rings. */
export class WkbReadError extends Error {
  override readonly name = 'WkbReadError';
}

const WKB_POLYGON = 3;
const WKB_MULTI_POLYGON = 6;

/** Reads a hex WKB MultiPolygon (or Polygon) of 2D rings into coordinates. */
export function multiPolygonFromWkbHex(hex: string): MultiPolygonCoords {
  const bytes = Buffer.from(hex, 'hex');
  let offset = 0;
  const need = (n: number) => {
    if (offset + n > bytes.length) {
      throw new WkbReadError('the WKB ends early');
    }
  };
  const header = (): { little: boolean; type: number } => {
    need(5);
    const order = bytes.readUInt8(offset);
    if (order !== 0 && order !== 1) {
      throw new WkbReadError('the WKB byte order is neither 0 nor 1');
    }
    const little = order === 1;
    const type = little ? bytes.readUInt32LE(offset + 1) : bytes.readUInt32BE(offset + 1);
    offset += 5;
    return { little, type };
  };
  const uint = (little: boolean): number => {
    need(4);
    const value = little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const double = (little: boolean): number => {
    need(8);
    const value = little ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
    offset += 8;
    return value;
  };
  const polygon = (little: boolean): Position[][] => {
    const rings: Position[][] = [];
    const ringCount = uint(little);
    for (let r = 0; r < ringCount; r += 1) {
      const pointCount = uint(little);
      const ring: Position[] = [];
      for (let p = 0; p < pointCount; p += 1) {
        ring.push([double(little), double(little)]);
      }
      rings.push(ring);
    }
    return rings;
  };
  const top = header();
  let out: Position[][][];
  if (top.type === WKB_POLYGON) {
    out = [polygon(top.little)];
  } else if (top.type === WKB_MULTI_POLYGON) {
    out = [];
    const count = uint(top.little);
    for (let i = 0; i < count; i += 1) {
      const inner = header();
      if (inner.type !== WKB_POLYGON) {
        throw new WkbReadError('a MultiPolygon member is not a Polygon');
      }
      out.push(polygon(inner.little));
    }
  } else {
    throw new WkbReadError('the WKB is not a Polygon or MultiPolygon');
  }
  if (offset !== bytes.length) {
    throw new WkbReadError('the WKB has bytes after its geometry');
  }
  return out;
}

export type Bbox = readonly [number, number, number, number];

/** The bounding box of the coordinates, or null when there are none. */
export function bboxOf(coords: MultiPolygonCoords): Bbox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of coords) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}

function inRing(point: Position, ring: readonly Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when the point is inside one polygon's outer ring and in none of its holes. */
export function pointInMultiPolygon(point: Position, coords: MultiPolygonCoords): boolean {
  for (const polygon of coords) {
    const [outer, ...holes] = polygon;
    if (outer === undefined || !inRing(point, outer)) continue;
    if (!holes.some((hole) => inRing(point, hole))) return true;
  }
  return false;
}

export type StateShape = {
  readonly state: string;
  readonly coords: MultiPolygonCoords;
  readonly bbox: Bbox;
};

function covering(point: Position, shapes: readonly StateShape[]): string | null {
  const [x, y] = point;
  for (const shape of shapes) {
    const [minX, minY, maxX, maxY] = shape.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (pointInMultiPolygon(point, shape.coords)) return shape.state;
  }
  return null;
}

/** A shape from a geometry row's hex WKB, or null when the row has none. */
export function stateShape(state: string, wkbHex: string | null): StateShape | null {
  if (wkbHex === null) return null;
  const coords = multiPolygonFromWkbHex(wkbHex);
  const bbox = bboxOf(coords);
  return bbox === null ? null : { state, coords, bbox };
}

function coordinate(value: string | number | null | undefined): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One row per ZCTA from the `zcta520` attribute table: the state whose land-clipped display
 * geometry covers its internal point, else the state whose lookup geometry covers it; a point
 * covered by neither (a territory) is skipped and counted.
 */
export function assignZctas(
  table: readonly DbfRow[],
  display: readonly StateShape[],
  lookup: readonly StateShape[],
): { rows: BZipCentroid[]; unassigned: number } {
  const rows: BZipCentroid[] = [];
  let unassigned = 0;
  for (const row of table) {
    const zip = row['ZCTA5CE20'];
    const lat = coordinate(row['INTPTLAT20']);
    const lng = coordinate(row['INTPTLON20']);
    if (typeof zip !== 'string' || !/^\d{5}$/.test(zip) || lat === null || lng === null) {
      throw new WkbReadError('a ZCTA row has no readable ZCTA5CE20 or internal point');
    }
    const point: Position = [lng, lat];
    const state = covering(point, display) ?? covering(point, lookup);
    if (state === null) {
      unassigned += 1;
      continue;
    }
    rows.push(BZipCentroidSchema.parse({ source_key: `zcta:${zip}`, zip, state, lng, lat }));
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.source_key), Buffer.from(b.source_key)));
  return { rows, unassigned };
}

/** The state's own geometry row among a state's geometry rows. */
export async function stateGeometryRow(
  rows: AsyncIterable<Pick<BGeometry, 'source_key' | 'display_wkb' | 'lookup_wkb'>>,
  stateFips: string,
): Promise<{ display_wkb: string | null; lookup_wkb: string | null } | null> {
  const key = `tiger:state:${stateFips}`;
  for await (const row of rows) {
    if (row.source_key === key) {
      return { display_wkb: row.display_wkb, lookup_wkb: row.lookup_wkb };
    }
  }
  return null;
}
