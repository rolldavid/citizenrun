import { createHash } from 'node:crypto';

// B-geometry: little-endian WKB, SRID 4326 implied (P8-02: written in the package).

/** A longitude and latitude. */
export type Position = readonly [number, number];

const LITTLE_ENDIAN = 0x01;
const WKB_POINT = 1;
const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;
const MIN_RING_POINTS = 4;

/** A ring with fewer than four points, or whose last point is not its first. */
export class RingNotClosedError extends Error {
  override readonly name = 'RingNotClosedError';

  constructor(points: number) {
    super(
      `a ring of ${String(points)} points is not closed: it needs at least four, the last equal to the first`,
    );
  }
}

class WkbWriter {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  header(type: number): void {
    this.view.setUint8(this.offset, LITTLE_ENDIAN);
    this.view.setUint32(this.offset + 1, type, true);
    this.offset += 5;
  }

  count(n: number): void {
    this.view.setUint32(this.offset, n, true);
    this.offset += 4;
  }

  position(p: Position): void {
    this.view.setFloat64(this.offset, p[0], true);
    this.view.setFloat64(this.offset + 8, p[1], true);
    this.offset += 16;
  }
}

function checkRing(ring: readonly Position[]): void {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    ring.length < MIN_RING_POINTS ||
    first === undefined ||
    last === undefined ||
    first[0] !== last[0] ||
    first[1] !== last[1]
  ) {
    throw new RingNotClosedError(ring.length);
  }
}

/**
 * A WKB MultiPolygon: byte order, type 6, the polygon count, then each polygon as a full WKB
 * Polygon (byte order, type 3, ring count, each ring its point count and its points). Rings are
 * written as given; each must be closed by the caller.
 */
export function multiPolygonToWkb(
  polygons: readonly (readonly (readonly Position[])[])[],
): Uint8Array {
  let size = 9;
  for (const polygon of polygons) {
    size += 9;
    for (const ring of polygon) {
      checkRing(ring);
      size += 4 + ring.length * 16;
    }
  }
  const writer = new WkbWriter(new Uint8Array(size));
  writer.header(WKB_MULTIPOLYGON);
  writer.count(polygons.length);
  for (const polygon of polygons) {
    writer.header(WKB_POLYGON);
    writer.count(polygon.length);
    for (const ring of polygon) {
      writer.count(ring.length);
      for (const point of ring) {
        writer.position(point);
      }
    }
  }
  return writer.bytes;
}

/** A WKB Point: byte order, type 1, two float64s. */
export function pointToWkb(p: Position): Uint8Array {
  const writer = new WkbWriter(new Uint8Array(21));
  writer.header(WKB_POINT);
  writer.position(p);
  return writer.bytes;
}

/** Lower-case hex. */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

/** The lower-case hex SHA-256 of the WKB bytes (02 T-districts). */
export function geomHash(wkb: Uint8Array): string {
  return createHash('sha256').update(wkb).digest('hex');
}
