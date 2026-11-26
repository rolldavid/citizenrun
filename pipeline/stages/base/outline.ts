// The district outline of PIPE-geometry step 7 (D-208, P8-12): Douglas-Peucker in Web Mercator
// metres, written here so the result is the same on every machine.

/** A longitude and latitude, or a projected x and y. */
type Point = readonly [number, number];
type Ring = readonly Point[];
type Polygon = readonly Ring[];

/** The coordinates of a MultiPolygon: polygons, each its outer ring and then its holes. */
export type OutlineCoords = readonly Polygon[];

export type Outline = {
  outline_svg: string;
  outline_bbox: [number, number, number, number];
};

/** PIPE-geometry step 7: an outline has at most this many points. */
export const OUTLINE_MAX_POINTS = 400;
/** PIPE-geometry step 7: the longer side of the outline spans this many units. */
export const OUTLINE_BOX = 1000;
/** PIPE-geometry step 7: a part or hole smaller than this share of the largest part is dropped. */
export const OUTLINE_MIN_PART_SHARE = 0.01;
/** PIPE-geometry step 7: the first Douglas-Peucker tolerance, in metres, doubled until it fits. */
export const OUTLINE_START_TOLERANCE_M = 1;

/** 02 `districts_outline_svg_check`. */
const OUTLINE_PATTERN = /^[MLHVZmlhvz0-9 ,.-]+$/;
const OUTLINE_MAX_CHARS = 20_000;

const EARTH_RADIUS_M = 6378137;
const MAX_MERCATOR_LAT = 85.05112878;

function project(p: Point): Point {
  const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, p[1]));
  const lambda = (p[0] * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  return [EARTH_RADIUS_M * lambda, EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + phi / 2))];
}

/** The ring's area by the shoelace formula, always non-negative. */
function ringArea(ring: Ring): number {
  let twice = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a !== undefined && b !== undefined) {
      twice += a[0] * b[1] - b[0] * a[1];
    }
  }
  return Math.abs(twice) / 2;
}

/** The distance from `p` to the segment from `a` to `b` (to `a` when the two are equal). */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** The ring's positions without the closing point and without consecutive repeats. */
function distinctPositions(ring: Ring): Point[] {
  const out: Point[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== p[0] || last[1] !== p[1]) {
      out.push(p);
    }
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first === undefined || last === undefined || first[0] !== last[0] || first[1] !== last[1]) {
      break;
    }
    out.pop();
  }
  return out;
}

/**
 * Douglas-Peucker over the closed ring at tolerance `t`, iteratively: the first point and the
 * closing point are kept, and every point farther than `t` from the segment it splits. Returns the
 * kept positions without the closing point.
 */
function simplifyRing(ring: Ring, t: number): Point[] {
  const n = ring.length;
  if (n < 3) {
    return distinctPositions(ring);
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  for (let span = stack.pop(); span !== undefined; span = stack.pop()) {
    const [first, last] = span;
    const a = ring[first];
    const b = ring[last];
    if (a === undefined || b === undefined) {
      continue;
    }
    let farthest = -1;
    let farthestDistance = t;
    for (let i = first + 1; i < last; i += 1) {
      const p = ring[i];
      if (p === undefined) {
        continue;
      }
      const d = segmentDistance(p, a, b);
      if (d > farthestDistance) {
        farthest = i;
        farthestDistance = d;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const kept: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = ring[i];
    if (keep[i] === 1 && p !== undefined) {
      kept.push(p);
    }
  }
  return distinctPositions(kept);
}

/**
 * Three positions of the ring that stand far apart, in ring order: the first position, the one
 * farthest from it, and the one farthest from the segment between those two.
 */
function threeFarthestApart(ring: Ring): Point[] {
  const points = distinctPositions(ring);
  const a = points[0];
  if (a === undefined) {
    return [];
  }
  let bIndex = 0;
  let bDistance = -1;
  points.forEach((p, i) => {
    const d = Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (d > bDistance) {
      bIndex = i;
      bDistance = d;
    }
  });
  const b = points[bIndex];
  if (b === undefined) {
    return [a];
  }
  let cIndex = 0;
  let cDistance = -1;
  points.forEach((p, i) => {
    const d = segmentDistance(p, a, b);
    if (d > cDistance) {
      cIndex = i;
      cDistance = d;
    }
  });
  const indexes = [...new Set([0, bIndex, cIndex])].sort((x, y) => x - y);
  return indexes.flatMap((i) => {
    const p = points[i];
    return p === undefined ? [] : [p];
  });
}

/** A kept polygon: its rings in metres, its area, and whether it is the largest part. */
type Part = { rings: Ring[]; area: number; largest: boolean };

/** Parts by step 7.2: the largest always; the others and every hole when at least 1% of it. */
function keptParts(coords: OutlineCoords): Part[] {
  const projected = coords.map((polygon) => polygon.map((ring) => ring.map(project)));
  const areas = projected.map((polygon) =>
    polygon.reduce((sum, ring, i) => (i === 0 ? sum + ringArea(ring) : sum - ringArea(ring)), 0),
  );
  let largestIndex = -1;
  let largestArea = -Infinity;
  areas.forEach((area, i) => {
    if (area > largestArea) {
      largestIndex = i;
      largestArea = area;
    }
  });
  const floor = Math.max(0, largestArea) * OUTLINE_MIN_PART_SHARE;
  const parts: Part[] = [];
  projected.forEach((polygon, i) => {
    const area = areas[i] ?? 0;
    const largest = i === largestIndex;
    const outer = polygon[0];
    if (outer === undefined || (!largest && area < floor)) {
      return;
    }
    const holes = polygon.slice(1).filter((hole) => ringArea(hole) >= floor);
    parts.push({ rings: [outer, ...holes], area, largest });
  });
  // Descending area, the input order breaking ties: the order the outline is written in.
  return parts
    .map((part, i) => ({ part, i }))
    .sort((x, y) => y.part.area - x.part.area || x.i - y.i)
    .map(({ part }) => part);
}

/** One polygon of the simplified outline: outer ring first, each ring without its closing point. */
type SimplePart = { rings: Point[][]; area: number; largest: boolean };

/** Every kept ring simplified at `t`, with the ring and polygon drops of step 7.3. */
function simplifyParts(parts: readonly Part[], t: number): SimplePart[] {
  const out: SimplePart[] = [];
  for (const part of parts) {
    const [outerRing, ...holeRings] = part.rings;
    if (outerRing === undefined) {
      continue;
    }
    let outer = simplifyRing(outerRing, t);
    if (outer.length < 3 && part.largest) {
      outer = threeFarthestApart(outerRing);
    }
    // A polygon whose outer ring is gone is gone with its holes.
    if (outer.length < 3) {
      continue;
    }
    const rings: Point[][] = [outer];
    for (const hole of holeRings) {
      const simple = simplifyRing(hole, t);
      if (simple.length >= 3) {
        rings.push(simple);
      }
    }
    out.push({ rings, area: part.area, largest: part.largest });
  }
  return out;
}

function countPoints(parts: readonly SimplePart[]): number {
  return parts.reduce((sum, part) => sum + part.rings.reduce((s, ring) => s + ring.length, 0), 0);
}

function diagonal(parts: readonly Part[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    for (const ring of part.rings) {
      for (const p of ring) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
  }
  return minX === Infinity ? 0 : Math.hypot(maxX - minX, maxY - minY);
}

/** Rounds half away from zero to `places` decimals; -0 becomes 0. */
function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Step 7.4 and 7.5: the 1,000-unit box and the path, or null. */
function writeOutline(parts: readonly SimplePart[]): Outline | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    for (const ring of part.rings) {
      for (const p of ring) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
  }
  if (minX === Infinity) {
    return null;
  }
  const s = Math.max(maxX - minX, maxY - minY) / OUTLINE_BOX;
  if (s === 0 || !Number.isFinite(s)) {
    return null;
  }
  const paths: string[] = [];
  for (const part of parts) {
    const ringPaths: string[] = [];
    for (const [i, ring] of part.rings.entries()) {
      // Non-negative after the box transform, so Math.round rounds half away from zero here.
      const boxed = distinctPositions(
        ring.map((p): Point => [Math.round((p[0] - minX) / s), Math.round((maxY - p[1]) / s)]),
      );
      if (boxed.length < 3) {
        if (i === 0) {
          if (part.largest) {
            return null;
          }
          ringPaths.length = 0;
          break;
        }
        continue;
      }
      ringPaths.push(
        boxed
          .map((p, j) => `${j === 0 ? 'M' : 'L'} ${String(p[0])} ${String(p[1])}`)
          .join(' ')
          .concat(' Z'),
      );
    }
    paths.push(...ringPaths);
  }
  const svg = paths.join(' ');
  if (svg.length === 0 || svg.length > OUTLINE_MAX_CHARS || !OUTLINE_PATTERN.test(svg)) {
    return null;
  }
  return {
    outline_svg: svg,
    outline_bbox: [roundTo(minX, 2), roundTo(minY, 2), roundTo(maxX, 2), roundTo(maxY, 2)],
  };
}

/**
 * The outline with the tolerance it was reached at and the points counted before the box
 * transform. `outlineFor` is the product; the tolerance is read by the tests.
 */
export function outlineDetail(coords: OutlineCoords): {
  outline: Outline | null;
  toleranceM: number;
  points: number;
} {
  const parts = keptParts(coords);
  const limit = diagonal(parts);
  let t = OUTLINE_START_TOLERANCE_M;
  let simple = simplifyParts(parts, t);
  while (countPoints(simple) > OUTLINE_MAX_POINTS && t <= limit) {
    t *= 2;
    simple = simplifyParts(parts, t);
  }
  // Past the diagonal: drop parts from the smallest up, never the largest.
  while (countPoints(simple) > OUTLINE_MAX_POINTS) {
    let smallest = -1;
    simple.forEach((part, i) => {
      if (!part.largest && (smallest === -1 || part.area <= (simple[smallest]?.area ?? 0))) {
        smallest = i;
      }
    });
    if (smallest === -1) {
      break;
    }
    simple = simple.filter((_, i) => i !== smallest);
  }
  const points = countPoints(simple);
  const outline = points > OUTLINE_MAX_POINTS ? null : writeOutline(simple);
  return { outline, toleranceM: t, points };
}

/**
 * PIPE-geometry step 7: an outline of at most 400 points in a 1,000-unit box, with its Web
 * Mercator bounding box, or null when no outline can be written (02 `districts_outline_svg_check`).
 */
export function outlineFor(coords: OutlineCoords): Outline | null {
  return outlineDetail(coords).outline;
}
