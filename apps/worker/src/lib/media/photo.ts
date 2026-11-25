import { createHash } from 'node:crypto';
import { encode } from 'blurhash';
import sharp from 'sharp';
import type { Metadata, SharpOptions } from 'sharp';
import { differenceHash } from './dhash.ts';
import type { ImageFamily } from './sniff.ts';

// The shared photo function (D-250, R-111): refuses anything but a sane JPEG, PNG or WebP, turns
// it upright and re-encodes it. sharp's default output carries no metadata at all, and nothing here
// asks it to keep any (INV-41).

export const PHOTO_MAX_INPUT_PIXELS = 50_000_000; // D-250
export const PHOTO_JPEG_QUALITY = 82; // D-250
export const AVATAR_SIZES = [1080, 320] as const; // L-object-keys
export type PhotoKind = 'avatar'; // later milestones add their kinds
export type PhotoOutput = {
  name: '1080.jpg' | '320.jpg';
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
};
export type ProcessedPhoto = {
  format: ImageFamily;
  outputs: readonly PhotoOutput[];
  blurhash: string;
  dhash: bigint;
  originalSha256: string;
};
export type PhotoRejectReason = 'unsupported_format' | 'undecodable' | 'too_many_pixels';

export class PhotoRejected extends Error {
  override readonly name = 'PhotoRejected';
  readonly reason: PhotoRejectReason;

  constructor(reason: PhotoRejectReason) {
    super(reason);
    this.reason = reason;
  }
}

// D-250: a truncated or damaged file is refused, and a huge one before it is decoded.
const INPUT_OPTIONS = {
  failOn: 'warning',
  limitInputPixels: PHOTO_MAX_INPUT_PIXELS,
} as const satisfies SharpOptions;

const BLURHASH_WIDTH = 32; // D-250
const BLURHASH_X_COMPONENTS = 4; // D-250
const BLURHASH_Y_COMPONENTS = 3; // D-250

// EXIF orientations that turn the stored image by a quarter turn.
const QUARTER_TURNS: ReadonlySet<number> = new Set([5, 6, 7, 8]);

const OUTPUT_NAMES = { 1080: '1080.jpg', 320: '320.jpg' } as const;

// The squares each kind is made into.
const SQUARE_SIZES: { readonly [K in PhotoKind]: readonly (typeof AVATAR_SIZES)[number][] } = {
  avatar: AVATAR_SIZES,
};

/** Lower-case hex SHA-256 of the bytes: content hashing, not a credential. */
export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function familyOf(format: Metadata['format']): ImageFamily | null {
  return format === 'jpeg' || format === 'png' || format === 'webp' ? format : null;
}

// sharp's own guard reports the limit in its message; nothing else of the message is kept.
function isPixelLimit(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

function rejectionOf(error: unknown): PhotoRejected {
  return new PhotoRejected(isPixelLimit(error) ? 'too_many_pixels' : 'undecodable');
}

async function readMetadata(input: Uint8Array): Promise<Metadata> {
  try {
    return await sharp(input, INPUT_OPTIONS).metadata();
  } catch (error) {
    throw rejectionOf(error);
  }
}

// A centred square of side `min(size, side)`: capping the target at the short side keeps the
// result square without ever enlarging it.
async function squareOutput(
  input: Uint8Array,
  size: (typeof AVATAR_SIZES)[number],
  side: number,
): Promise<PhotoOutput> {
  const target = Math.min(size, side);
  const { data, info } = await sharp(input, INPUT_OPTIONS)
    .autoOrient()
    .resize(target, target, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: PHOTO_JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const bytes = new Uint8Array(data);
  return {
    name: OUTPUT_NAMES[size],
    bytes,
    width: info.width,
    height: info.height,
    sha256: sha256Of(bytes),
  };
}

async function blurhashOf(small: PhotoOutput): Promise<string> {
  const { data, info } = await sharp(small.bytes)
    .resize(BLURHASH_WIDTH)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encode(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
    BLURHASH_X_COMPONENTS,
    BLURHASH_Y_COMPONENTS,
  );
}

/**
 * Checks, orients and re-encodes one photo. Throws PhotoRejected with `unsupported_format` for any
 * format but JPEG, PNG and WebP, `too_many_pixels` above PHOTO_MAX_INPUT_PIXELS (checked before any
 * decode), and `undecodable` for anything sharp refuses. Avatars give two centred squares, 1080 and
 * 320 on a side or the short side when that is smaller, made one at a time.
 */
export async function processPhoto(input: Uint8Array, kind: PhotoKind): Promise<ProcessedPhoto> {
  const metadata = await readMetadata(input);
  const format = familyOf(metadata.format);
  if (format === null) {
    throw new PhotoRejected('unsupported_format');
  }
  if (metadata.width * metadata.height > PHOTO_MAX_INPUT_PIXELS) {
    throw new PhotoRejected('too_many_pixels');
  }
  const turned = metadata.orientation !== undefined && QUARTER_TURNS.has(metadata.orientation);
  const orientedWidth = turned ? metadata.height : metadata.width;
  const orientedHeight = turned ? metadata.width : metadata.height;
  const side = Math.min(orientedWidth, orientedHeight);

  try {
    const outputs: PhotoOutput[] = [];
    for (const size of SQUARE_SIZES[kind]) {
      outputs.push(await squareOutput(input, size, side));
    }
    const small = outputs.find((output) => output.name === OUTPUT_NAMES[320]);
    if (small === undefined) {
      throw new PhotoRejected('undecodable');
    }
    const blurhash = await blurhashOf(small);
    const dhash = await differenceHash(sharp(input, INPUT_OPTIONS).autoOrient());
    return { format, outputs, blurhash, dhash, originalSha256: sha256Of(input) };
  } catch (error) {
    if (error instanceof PhotoRejected) {
      throw error;
    }
    throw rejectionOf(error);
  }
}
