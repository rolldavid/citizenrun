import sharp from 'sharp';

// The worker's photo encoding, which the seed copies because it cannot import the worker (D-250).
const JPEG_QUALITY = 82; // D-250
// The stored avatar squares and the placeholder's drawing: a circle 540 pixels across, centred.
const ORIGINAL_SIDE = 1080;
const LARGE_SIDE = 1080;
const SMALL_SIDE = 320;
const CIRCLE_CENTRE = 540;
const CIRCLE_RADIUS = 270;
// A color as the token module and the issues table write it; nothing else reaches the drawing.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function hexColor(value: string, name: string): string {
  if (!HEX_COLOR.test(value)) {
    throw new RangeError(`${name} must be a #rrggbb color`);
  }
  return value;
}

async function square(original: Buffer, side: number): Promise<Buffer> {
  return sharp(original)
    .resize(side, side, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** The 1080 and 320 square JPEGs of one seed avatar: a flat issue-color field with a centred bg-colored circle, re-encoded as the worker's photo function writes avatars. */
export async function seedAvatarImages(input: {
  issueColorLight: string;
  bgLight: string;
}): Promise<{ original: Buffer; w1080: Buffer; w320: Buffer }> {
  const field = hexColor(input.issueColorLight, 'issueColorLight');
  const circleFill = hexColor(input.bgLight, 'bgLight');
  const circle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(ORIGINAL_SIDE)}" height="${String(ORIGINAL_SIDE)}">` +
      `<circle cx="${String(CIRCLE_CENTRE)}" cy="${String(CIRCLE_CENTRE)}" r="${String(CIRCLE_RADIUS)}" fill="${circleFill}"/></svg>`,
  );
  const original = await sharp({
    create: { width: ORIGINAL_SIDE, height: ORIGINAL_SIDE, channels: 3, background: field },
  })
    .composite([{ input: circle }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  // No withMetadata call, so nothing of the original is carried over; an avatar has no BlurHash (D-471).
  const [w1080, w320] = await Promise.all([
    square(original, LARGE_SIDE),
    square(original, SMALL_SIDE),
  ]);
  return { original, w1080, w320 };
}
