// MAP-outline: a district's outline as the API sends it, parsed and projected. Pure: no React, no
// clock, no network. The path data comes from a bundle and is never trusted as markup, so anything
// but the pipeline's own grammar gives null and the caller draws nothing.

/** `svg`: absolute M, L and Z commands with integers in a box whose longer side is 1,000 units, y down. `bbox`: [minX, minY, maxX, maxY] in EPSG:3857 metres. */
export type Outline = { svg: string; bbox: readonly [number, number, number, number] };
/** What a caller passes for an outline. */
export type OutlineInput = Outline;

type Point = readonly [number, number];

const EARTH_RADIUS = 6378137;
const LONGER_SIDE = 1000;
const ALPHABET = /^[MLZ0-9 ,-]+$/;
const TOKEN = /([MLZ])|(-?\d+)|([ ,]+)/y;

/** Outline units to metres: the box's scale, with y flipped. */
function toMetres(point: Point, bbox: Outline['bbox']): Point {
  const [minX, minY, maxX, maxY] = bbox;
  const scale = Math.max(maxX - minX, maxY - minY) / LONGER_SIDE;
  return [minX + point[0] * scale, maxY - point[1] * scale];
}

/** EPSG:3857 metres to degrees. */
function toLngLat([x, y]: Point): readonly [lng: number, lat: number] {
  return [
    ((x / EARTH_RADIUS) * 180) / Math.PI,
    ((2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180) / Math.PI,
  ];
}

/** The outline's own box in its units: the longer side is 1,000, each side at least 1; 1 by 1 for an empty box. */
export function outlineViewBox(bbox: Outline['bbox']): { width: number; height: number } {
  const [minX, minY, maxX, maxY] = bbox;
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.max(width, height) / LONGER_SIDE;
  if (!(scale > 0)) return { width: 1, height: 1 };
  return {
    width: Math.max(1, Math.round(width / scale)),
    height: Math.max(1, Math.round(height / scale)),
  };
}

/** The commands and integers of path data, or null when anything else is in it. */
function tokensOf(svg: string): (string | number)[] | null {
  if (!ALPHABET.test(svg)) return null;
  const tokens: (string | number)[] = [];
  let position = 0;
  let separated = true;
  while (position < svg.length) {
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(svg);
    if (match === null) return null;
    const [whole, command, integer] = match;
    position += whole.length;
    if (command !== undefined) {
      tokens.push(command);
      separated = true;
    } else if (integer !== undefined) {
      // Two integers must have a space or a comma between them.
      if (!separated) return null;
      tokens.push(Number(integer));
      separated = false;
    } else {
      separated = true;
    }
  }
  return tokens;
}

/** Rings of [x, y] in outline units, one per M...Z subpath; null when the string is anything but M, L, Z and integers. */
export function parseOutline(svg: string): Array<Array<readonly [number, number]>> | null {
  const tokens = tokensOf(svg);
  if (tokens === null) return null;
  const rings: Array<Array<readonly [number, number]>> = [];
  let ring: Array<readonly [number, number]> | null = null;
  let index = 0;
  const pair = (): Point | null => {
    const x = tokens[index];
    const y = tokens[index + 1];
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    index += 2;
    return [x, y];
  };
  while (index < tokens.length) {
    const command = tokens[index];
    index += 1;
    if (command === 'M') {
      if (ring !== null) rings.push(ring);
      const start = pair();
      if (start === null) return null;
      ring = [start];
    } else if (command === 'L') {
      if (ring === null) return null;
      const first = pair();
      if (first === null) return null;
      ring.push(first);
      while (typeof tokens[index] === 'number') {
        const next = pair();
        if (next === null) return null;
        ring.push(next);
      }
    } else if (command === 'Z') {
      if (ring === null) return null;
      rings.push(ring);
      ring = null;
    } else {
      // An integer where a command belongs: a pair before any M, or a third number in a pair.
      return null;
    }
  }
  if (ring !== null) rings.push(ring);
  return rings.length > 0 ? rings : null;
}

/** The outline as closed lines in degrees, for a GeoJSON source; null when it cannot be parsed. */
export function outlineToGeoJson(outline: Outline): {
  type: 'MultiLineString';
  coordinates: Array<Array<readonly [lng: number, lat: number]>>;
} | null {
  const rings = parseOutline(outline.svg);
  if (rings === null) return null;
  return {
    type: 'MultiLineString',
    coordinates: rings.map((ring) => {
      const line = ring.map((point) => toLngLat(toMetres(point, outline.bbox)));
      const [first] = line;
      return first === undefined ? line : [...line, first];
    }),
  };
}

/** Area of the bbox in square metres of EPSG:3857: the reveal's sort key. */
export function outlineBoxArea(bbox: Outline['bbox']): number {
  const [minX, minY, maxX, maxY] = bbox;
  return (maxX - minX) * (maxY - minY);
}
