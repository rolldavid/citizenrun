import { createHash } from 'node:crypto';

// Well-known binary for fixture geometry (B-geometry: little-endian hex, SRID 4326 implied).

const BYTE_ORDER_LITTLE = 1;
const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;

/** The little-endian WKB, as hex, of a MultiPolygon holding one square polygon (one ring of five points). */
export function squareWkbHex(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): string {
  const ring = [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];
  const buffer = Buffer.alloc(1 + 4 + 4 + 1 + 4 + 4 + 4 + ring.length * 16);
  let at = 0;
  at = buffer.writeUInt8(BYTE_ORDER_LITTLE, at);
  at = buffer.writeUInt32LE(WKB_MULTIPOLYGON, at);
  at = buffer.writeUInt32LE(1, at);
  at = buffer.writeUInt8(BYTE_ORDER_LITTLE, at);
  at = buffer.writeUInt32LE(WKB_POLYGON, at);
  at = buffer.writeUInt32LE(1, at);
  at = buffer.writeUInt32LE(ring.length, at);
  for (const [x = 0, y = 0] of ring) {
    at = buffer.writeDoubleLE(x, at);
    at = buffer.writeDoubleLE(y, at);
  }
  return buffer.toString('hex');
}

/** The lower-case hex SHA-256 of the bytes a hex string decodes to (the geom_hash rule of T-districts). */
export function sha256Hex(hex: string): string {
  return createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
}
