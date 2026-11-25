import sharp from 'sharp';

// Sample images for the photo tests, made with sharp in the test; none is committed.

const RED = { r: 255, g: 0, b: 0 } as const;
const BLUE = { r: 0, g: 0, b: 255 } as const;

const EXIF_HEADER = 'Exif\0\0';
const ORIENTATION_TAG = 0x0112;
const GPS_IFD_TAG = 0x8825;
const IFD_ENTRY_BYTES = 12;

type Rgb = { r: number; g: number; b: number };

/** A single-colour JPEG of the given size. */
export async function solidJpeg(width: number, height: number, colour: Rgb = RED): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();
}

/** A JPEG whose stored left half is red and right half blue. */
export async function splitJpeg(width: number, height: number): Promise<Buffer> {
  const half = Math.floor(width / 2);
  const right = await sharp({
    create: { width: width - half, height, channels: 3, background: BLUE },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 3, background: RED } })
    .composite([{ input: right, left: half, top: 0 }])
    .jpeg()
    .toBuffer();
}

/** A single-colour PNG; at 10000 by 10000 it is a decompression bomb of a few hundred kilobytes. */
export async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: RED } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** A single-colour WebP. */
export async function solidWebp(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: BLUE } })
    .webp()
    .toBuffer();
}

/** A single-colour GIF. */
export async function solidGif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: RED } })
    .gif()
    .toBuffer();
}

/** The first half of the bytes. */
export function truncated(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.subarray(0, Math.floor(bytes.length / 2)));
}

/** The start of a HEIC file: a box size, then 'ftypheic' at offset 4, then padding. */
export function heicHead(): Buffer {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypheic', 'latin1'),
    Buffer.alloc(64),
  ]);
}

/** An HTML page's bytes. */
export function htmlBytes(): Buffer {
  return Buffer.from('<!doctype html><html><body>not an image</body></html>', 'utf8');
}

type Tiff = { offset: number; littleEndian: boolean };

function tiffOf(jpeg: Buffer): Tiff {
  const at = jpeg.indexOf(EXIF_HEADER, 0, 'latin1');
  if (at < 0) {
    throw new Error('The fixture has no EXIF block.');
  }
  const offset = at + EXIF_HEADER.length;
  return { offset, littleEndian: jpeg.toString('latin1', offset, offset + 2) === 'II' };
}

function readU16(jpeg: Buffer, tiff: Tiff, at: number): number {
  return tiff.littleEndian
    ? jpeg.readUInt16LE(tiff.offset + at)
    : jpeg.readUInt16BE(tiff.offset + at);
}

function readU32(jpeg: Buffer, tiff: Tiff, at: number): number {
  return tiff.littleEndian
    ? jpeg.readUInt32LE(tiff.offset + at)
    : jpeg.readUInt32BE(tiff.offset + at);
}

/** Each IFD0 entry of the JPEG's EXIF block: its tag and the offset of its value field in `jpeg`. */
export function ifd0Entries(jpeg: Buffer): { tag: number; valueAt: number }[] {
  const tiff = tiffOf(jpeg);
  const ifd0 = readU32(jpeg, tiff, 4);
  const count = readU16(jpeg, tiff, ifd0);
  const entries: { tag: number; valueAt: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = ifd0 + 2 + index * IFD_ENTRY_BYTES;
    entries.push({ tag: readU16(jpeg, tiff, entry), valueAt: tiff.offset + entry + 8 });
  }
  return entries;
}

/**
 * The orientation-6 fixture: a `width` by `height` JPEG whose stored left half is red and right
 * half blue, with an EXIF block holding a camera make in IFD0 and a GPS IFD with a position.
 * sharp writes the image's own orientation (1) over an IFD0 Orientation tag given to `withExif`,
 * so the tag's value is set to 6 in the written bytes.
 */
export async function rotatedJpegWithGps(width: number, height: number): Promise<Buffer> {
  const plain = await splitJpeg(width, height);
  const jpeg = await sharp(plain)
    .withExif({
      IFD0: { Make: 'FixtureCam', Orientation: '6' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '30/1 0/1 15/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '40/1 0/1 15/1',
      },
    })
    .jpeg()
    .toBuffer();
  const tiff = tiffOf(jpeg);
  const orientation = ifd0Entries(jpeg).find((entry) => entry.tag === ORIENTATION_TAG);
  if (orientation === undefined) {
    throw new Error('The fixture has no orientation tag.');
  }
  if (tiff.littleEndian) {
    jpeg.writeUInt16LE(6, orientation.valueAt);
  } else {
    jpeg.writeUInt16BE(6, orientation.valueAt);
  }
  return jpeg;
}

/** True when the JPEG's EXIF IFD0 points at a GPS IFD. */
export function hasGpsIfd(jpeg: Buffer): boolean {
  return ifd0Entries(jpeg).some((entry) => entry.tag === GPS_IFD_TAG);
}

/** The RGB value of one pixel of an image. */
export async function pixelAt(
  image: Uint8Array,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at] ?? -1, data[at + 1] ?? -1, data[at + 2] ?? -1];
}

/** True when every channel is within `tolerance` of the expected colour. */
export function near(pixel: readonly number[], colour: Rgb, tolerance = 40): boolean {
  const [r = -1, g = -1, b = -1] = pixel;
  return (
    Math.abs(r - colour.r) <= tolerance &&
    Math.abs(g - colour.g) <= tolerance &&
    Math.abs(b - colour.b) <= tolerance
  );
}

export { BLUE, RED };
