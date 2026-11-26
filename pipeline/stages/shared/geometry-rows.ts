// The geometry rows of the approximate, fallback and union districts that stages 2 and 4 create
// (PIPE-geometry steps 9 and 10), over the base load's geometry functions.
import { BGeometrySchema } from '@citizenrun/shared';
import type { BGeometry } from '@citizenrun/shared';
import { countyUnion, fallbackGeomHash, fallbackGeometry } from '../base/geometry.ts';
import type { MultiPolygonCoords } from '../base/geometry.ts';

const LITTLE_ENDIAN = 0x01;
const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;

/** WKB that is not little-endian, not a Polygon or MultiPolygon, or cut short. */
export class WkbDecodeError extends Error {
  override readonly name = 'WkbDecodeError';
}

/** A via or county row without the WKB a geometry row needs; names the row's key. */
export class GeometryInputMissing extends Error {
  override readonly name = 'GeometryInputMissing';

  constructor(key: string) {
    super(`the geometry row ${key} has no WKB`);
  }
}

class WkbReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.offset === this.view.byteLength;
  }

  private need(n: number): void {
    if (this.offset + n > this.view.byteLength) {
      throw new WkbDecodeError('the WKB is cut short');
    }
  }

  header(): number {
    this.need(5);
    if (this.view.getUint8(this.offset) !== LITTLE_ENDIAN) {
      throw new WkbDecodeError('the WKB is not little-endian');
    }
    const type = this.view.getUint32(this.offset + 1, true);
    this.offset += 5;
    return type;
  }

  count(): number {
    this.need(4);
    const n = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return n;
  }

  position(): readonly [number, number] {
    this.need(16);
    const p = [
      this.view.getFloat64(this.offset, true),
      this.view.getFloat64(this.offset + 8, true),
    ] as const;
    this.offset += 16;
    return p;
  }
}

function readPolygon(reader: WkbReader): (readonly (readonly [number, number])[])[] {
  const rings: (readonly (readonly [number, number])[])[] = [];
  const ringCount = reader.count();
  for (let r = 0; r < ringCount; r += 1) {
    const points: (readonly [number, number])[] = [];
    const pointCount = reader.count();
    for (let i = 0; i < pointCount; i += 1) {
      points.push(reader.position());
    }
    rings.push(points);
  }
  return rings;
}

/**
 * The coordinates of little-endian WKB hex: a MultiPolygon (type 6), or a Polygon (type 3) read as
 * one polygon. Any other type or byte order, a cut-short buffer or trailing bytes throw WkbDecodeError.
 */
export function decodeMultiPolygonHex(hex: string): MultiPolygonCoords {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) {
    throw new WkbDecodeError('the WKB is not lower-case hex');
  }
  const reader = new WkbReader(new Uint8Array(Buffer.from(hex, 'hex')));
  const type = reader.header();
  const polygons: (readonly (readonly (readonly [number, number])[])[])[] = [];
  if (type === WKB_POLYGON) {
    polygons.push(readPolygon(reader));
  } else if (type === WKB_MULTIPOLYGON) {
    const count = reader.count();
    for (let i = 0; i < count; i += 1) {
      if (reader.header() !== WKB_POLYGON) {
        throw new WkbDecodeError('a MultiPolygon member is not a Polygon');
      }
      polygons.push(readPolygon(reader));
    }
  } else {
    throw new WkbDecodeError('the WKB is not a Polygon or MultiPolygon');
  }
  if (!reader.done) {
    throw new WkbDecodeError('the WKB has trailing bytes');
  }
  return polygons;
}

/**
 * The geometry row of a fallback or approximate district: no WKB of its own, the hash of its via
 * keys, and the outline, box and label point of its via districts (one via: its own).
 */
export async function fallbackRow(key: string, via: readonly BGeometry[]): Promise<BGeometry> {
  const display = via.map((row) => {
    if (row.display_wkb === null) {
      throw new GeometryInputMissing(row.source_key);
    }
    return decodeMultiPolygonHex(row.display_wkb);
  });
  const outline = await fallbackGeometry(via, display);
  return BGeometrySchema.parse({
    source_key: key,
    lookup_wkb: null,
    display_wkb: null,
    label_point: outline.label_point,
    outline_svg: outline.outline_svg,
    outline_bbox: outline.outline_bbox,
    geom_hash: fallbackGeomHash(via.map((row) => row.source_key)),
  });
}

/** The exact geometry row of a county union, dissolved from its counties' rows. */
export async function unionRow(
  key: string,
  counties: readonly BGeometry[],
  stateFips: string,
): Promise<BGeometry> {
  const shapes = counties.map((row) => {
    if (row.lookup_wkb === null) {
      throw new GeometryInputMissing(row.source_key);
    }
    return {
      lookup: decodeMultiPolygonHex(row.lookup_wkb),
      display: row.display_wkb === null ? null : decodeMultiPolygonHex(row.display_wkb),
    };
  });
  return countyUnion(key, shapes, stateFips);
}
