import type { LngLat, LngLatBounds, ScreenPoint } from './types';

// PM-map-spike: the query area of a rendered-feature query and the facts kept from a feature's geometry.
// Pure, shared by both index files.

export type GeometryLike = { type: string; coordinates?: unknown } | null | undefined;

/** The point itself for a radius of 0 or below; otherwise the square of side 2 × radius around it. */
export function queryArea(
  at: ScreenPoint,
  radius: number,
): ScreenPoint | readonly [ScreenPoint, ScreenPoint] {
  if (!(radius > 0)) return { x: at.x, y: at.y };
  return [
    { x: at.x - radius, y: at.y - radius },
    { x: at.x + radius, y: at.y + radius },
  ];
}

export function centrePoint(size: { width: number; height: number }): ScreenPoint {
  return { x: size.width / 2, y: size.height / 2 };
}

const SPANNING = new Set([
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
]);

const NOTHING = { point: null, bounds: null } as const;

function isPosition(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length >= 2 && value.every((n) => typeof n === 'number');
}

/** The minimum and maximum longitude and latitude over every position at any depth; null when there is none
 *  or one is not a finite number. */
function boundsOf(coordinates: unknown): LngLatBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let count = 0;
  const pending: unknown[] = [coordinates];
  while (pending.length > 0) {
    const value = pending.pop();
    if (isPosition(value)) {
      const lng = value[0] as number;
      const lat = value[1] as number;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      count += 1;
    } else if (Array.isArray(value)) {
      pending.push(...(value as unknown[]));
    } else {
      return null;
    }
  }
  return count === 0 ? null : [west, south, east, north];
}

/** A point geometry gives its coordinates; a line or polygon gives its bounds; anything else gives nothing. */
export function featureFacts(geometry: GeometryLike): {
  point: LngLat | null;
  bounds: LngLatBounds | null;
} {
  if (geometry === null || geometry === undefined) return NOTHING;
  if (geometry.type === 'Point') {
    const position = geometry.coordinates;
    if (!isPosition(position)) return NOTHING;
    const lng = position[0] as number;
    const lat = position[1] as number;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return NOTHING;
    return { point: [lng, lat], bounds: null };
  }
  if (!SPANNING.has(geometry.type)) return NOTHING;
  const bounds = boundsOf(geometry.coordinates);
  return bounds === null ? NOTHING : { point: null, bounds };
}
