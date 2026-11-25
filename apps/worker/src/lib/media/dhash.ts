import type { Sharp } from 'sharp';

// D-353: the difference hash a later block-list compares at a Hamming distance.

const COLUMNS = 9;
const ROWS = 8;
const PIXELS = COLUMNS * ROWS;

/** 9×8 greyscale pixels, row-major: bit (8 × row + col), worth 2^(8 × row + col), is 1 when pixel col is brighter than pixel col + 1; returned as a signed 64-bit bigint. */
export function dhashFromPixels(pixels: Uint8Array): bigint {
  if (pixels.length !== PIXELS) {
    throw new RangeError('A difference hash takes exactly 72 pixels.');
  }
  let sum = 0n;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLUMNS - 1; col += 1) {
      const left = pixels[row * COLUMNS + col] ?? 0;
      const right = pixels[row * COLUMNS + col + 1] ?? 0;
      if (left > right) {
        sum += 1n << BigInt(8 * row + col);
      }
    }
  }
  return BigInt.asIntN(64, sum);
}

/** sharp(oriented input).greyscale().resize(9, 8, { fit: 'fill' }).raw(), then dhashFromPixels. */
export async function differenceHash(oriented: Sharp): Promise<bigint> {
  const { data, info } = await oriented
    .greyscale()
    .resize(COLUMNS, ROWS, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  // An input with alpha keeps it beside the grey channel; the grey value is each pixel's first byte.
  const grey = new Uint8Array(PIXELS);
  for (let index = 0; index < PIXELS; index += 1) {
    grey[index] = data[index * info.channels] ?? 0;
  }
  return dhashFromPixels(grey);
}
