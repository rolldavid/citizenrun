import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  BLUE,
  RED,
  hasGpsIfd,
  near,
  pixelAt,
  rotatedJpegWithGps,
  solidGif,
  solidJpeg,
  solidPng,
  solidWebp,
  truncated,
} from './images.fixtures.ts';
import { PHOTO_MAX_INPUT_PIXELS, PhotoRejected, processPhoto } from './photo.ts';
import type { PhotoOutput, PhotoRejectReason, ProcessedPhoto } from './photo.ts';

// Large fixtures take a second or two to encode and decode.
const SLOW_MS = 30_000;

function output(photo: ProcessedPhoto, name: PhotoOutput['name']): PhotoOutput {
  const found = photo.outputs.find((item) => item.name === name);
  if (found === undefined) {
    throw new Error(`no ${name} output`);
  }
  return found;
}

async function sizes(photo: ProcessedPhoto): Promise<Record<string, [number, number, string]>> {
  const result: Record<string, [number, number, string]> = {};
  for (const item of photo.outputs) {
    const metadata = await sharp(item.bytes).metadata();
    expect([metadata.width, metadata.height]).toEqual([item.width, item.height]);
    result[item.name] = [item.width, item.height, metadata.format];
  }
  return result;
}

async function rejection(input: Uint8Array): Promise<PhotoRejectReason | 'none'> {
  try {
    await processPhoto(input, 'avatar');
    return 'none';
  } catch (error) {
    if (error instanceof PhotoRejected) {
      return error.reason;
    }
    throw error;
  }
}

describe('processPhoto', () => {
  it(
    'makes two centred squares',
    async () => {
      const photo = await processPhoto(await solidJpeg(4000, 3000), 'avatar');
      expect(photo.format).toBe('jpeg');
      expect(await sizes(photo)).toEqual({
        '1080.jpg': [1080, 1080, 'jpeg'],
        '320.jpg': [320, 320, 'jpeg'],
      });
    },
    SLOW_MS,
  );

  it(
    'turns the image upright and strips its metadata',
    async () => {
      const input = await rotatedJpegWithGps(4000, 3000);
      const before = await sharp(input).metadata();
      expect(before.orientation).toBe(6);
      expect(before.exif).toBeDefined();
      expect(hasGpsIfd(input)).toBe(true);

      const photo = await processPhoto(input, 'avatar');

      const large = output(photo, '1080.jpg');
      // Stored left (red) becomes the top after a quarter turn clockwise; right (blue) the bottom.
      expect(near(await pixelAt(large.bytes, 540, 100), RED)).toBe(true);
      expect(near(await pixelAt(large.bytes, 540, 980), BLUE)).toBe(true);
      const small = output(photo, '320.jpg');
      expect(near(await pixelAt(small.bytes, 160, 30), RED)).toBe(true);
      expect(near(await pixelAt(small.bytes, 160, 290), BLUE)).toBe(true);
      for (const item of photo.outputs) {
        const metadata = await sharp(item.bytes).metadata();
        expect(metadata.exif).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.orientation).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
        expect(metadata.iptc).toBeUndefined();
      }
    },
    SLOW_MS,
  );

  it('never enlarges and stays square', async () => {
    const cases: [number, number, number][] = [
      [500, 400, 400],
      [1200, 400, 400],
      [200, 150, 150],
    ];
    for (const [width, height, side] of cases) {
      const photo = await processPhoto(await solidJpeg(width, height), 'avatar');
      expect(await sizes(photo), `${String(width)}x${String(height)}`).toEqual({
        '1080.jpg': [side, side, 'jpeg'],
        '320.jpg': [Math.min(320, side), Math.min(320, side), 'jpeg'],
      });
    }
  });

  it('accepts PNG and WebP', async () => {
    const png = await processPhoto(await solidPng(1600, 1200), 'avatar');
    expect(png.format).toBe('png');
    expect(await sizes(png)).toEqual({
      '1080.jpg': [1080, 1080, 'jpeg'],
      '320.jpg': [320, 320, 'jpeg'],
    });
    const webp = await processPhoto(await solidWebp(1200, 1600), 'avatar');
    expect(webp.format).toBe('webp');
    expect(await sizes(webp)).toEqual({
      '1080.jpg': [1080, 1080, 'jpeg'],
      '320.jpg': [320, 320, 'jpeg'],
    });
  });

  it('refuses what it cannot decode', async () => {
    expect(await rejection(truncated(await solidJpeg(1200, 900)))).toBe('undecodable');
    expect(await rejection(await solidGif(40, 30))).toBe('unsupported_format');
    expect(await rejection(new TextEncoder().encode('<!doctype html>'))).toBe('undecodable');
  });

  it(
    'refuses huge pixel counts',
    async () => {
      const jpeg = await solidJpeg(8000, 7000);
      expect(8000 * 7000).toBeGreaterThan(PHOTO_MAX_INPUT_PIXELS);
      expect(await rejection(jpeg)).toBe('too_many_pixels');
      // A decompression bomb: a hundred million pixels in a small file.
      const bomb = await solidPng(10_000, 10_000);
      expect(bomb.length).toBeLessThan(1_000_000);
      expect(await rejection(bomb)).toBe('too_many_pixels');
    },
    SLOW_MS,
  );

  it('hashes the input and each output', async () => {
    const input = await solidJpeg(1600, 1200, { r: 30, g: 120, b: 200 });
    const photo = await processPhoto(input, 'avatar');
    expect(photo.originalSha256).toBe(createHash('sha256').update(input).digest('hex'));
    const hashes = photo.outputs.map((item) => item.sha256);
    for (const item of photo.outputs) {
      expect(item.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(item.sha256).toBe(createHash('sha256').update(item.bytes).digest('hex'));
    }
    expect(new Set([photo.originalSha256, ...hashes]).size).toBe(3);
  });

  it('returns a blurhash and a difference hash', async () => {
    const photo = await processPhoto(await rotatedJpegWithGps(800, 600), 'avatar');
    expect(photo.blurhash).toHaveLength(28);
    expect(photo.dhash).toBeTypeOf('bigint');
    expect(BigInt.asIntN(64, photo.dhash)).toBe(photo.dhash);
  });
});
