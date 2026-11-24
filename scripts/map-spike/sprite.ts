import { crc32, deflateSync } from 'node:zlib';

/** One image of a sprite index, as MapLibre reads it. */
export type SpriteEntry = {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelRatio: number;
  sdf: boolean;
};

/** The side of the `map-box` image, in points. */
const BOX = 24;

/**
 * The spike's sprite index: one SDF box, `map-box`, colored by `icon-color` and stretched by
 * `icon-text-fit`.
 */
export function spriteIndex(pixelRatio: 1 | 2): Record<string, SpriteEntry> {
  return {
    'map-box': {
      x: 0,
      y: 0,
      width: BOX * pixelRatio,
      height: BOX * pixelRatio,
      pixelRatio,
      sdf: true,
    },
  };
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(4 + typeAndData.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 4 + typeAndData.length);
  return out;
}

/** A PNG of 8-bit RGBA rows, unfiltered, in one IDAT chunk. Throws on a buffer of the wrong length. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `map-spike: ${String(rgba.length)} bytes is not a ${String(width)} by ${String(height)} RGBA image`,
    );
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    rows[row * (stride + 1)] = 0; // filter type None
    rows.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return new Uint8Array(
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(rows)),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

/** The sprite image: the `map-box` square, white and fully opaque, 24 by 24 (48 by 48 at 2). */
export function spritePng(pixelRatio: 1 | 2): Uint8Array {
  const side = BOX * pixelRatio;
  return encodeRgbaPng(side, side, new Uint8Array(side * side * 4).fill(255));
}
