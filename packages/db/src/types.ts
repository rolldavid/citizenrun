import { customType } from 'drizzle-orm/pg-core';

/** Case-insensitive text (extension `citext`). */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** A full-text vector, maintained by SQL statements, never by Drizzle (D-235). */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

/** Raw bytes: `Uint8Array` in TypeScript, `Buffer` for the driver. */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
});

/**
 * A PostGIS column type `geometry(<kind>, <srid>)`. The TypeScript type is `string` only so the
 * column can be declared: geometry is written and read through SQL functions and never selected
 * into Node (D-235).
 */
export function geometry(kind: 'MultiPolygon' | 'Polygon' | 'Point', srid: 4326 | 3857) {
  return customType<{ data: string }>({
    dataType: () => `geometry(${kind}, ${String(srid)})`,
  });
}
