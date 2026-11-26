import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { zzPhotoJpeg } from '../testing/bundle-fixtures.ts';
import { assetFormatOk, createMediaAssetWriter } from './assets.ts';
import type { MediaObjectStore } from './assets.ts';

const NO_STORE: MediaObjectStore = {
  exists: () => Promise.reject(new Error('not used')),
  get: () => Promise.reject(new Error('not used')),
  put: () => Promise.reject(new Error('not used')),
};

describe('the media asset writer', () => {
  it('re-encodes a JPEG without resizing', async () => {
    const original = await sharp(await zzPhotoJpeg())
      .withExif({ IFD0: { Copyright: 'Fixture rights holder' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const writer = createMediaAssetWriter(NO_STORE);
    const out = await writer.reencodePhoto(original);
    expect(out).toMatchObject({ width: 320, height: 400 });
    const metadata = await sharp(out.jpeg).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 320, height: 400 });
    expect(metadata.exif).toBeUndefined();
    expect(await writer.measurePhoto(out.jpeg)).toEqual({ width: 320, height: 400 });
  });

  it('refuses a file that is not an image', async () => {
    await expect(
      createMediaAssetWriter(NO_STORE).reencodePhoto(Buffer.from('%PDF-1.7')),
    ).rejects.toThrow();
  });

  it('checks the magic bytes', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(assetFormatOk('photo', jpeg)).toBe(true);
    expect(assetFormatOk('form', new TextEncoder().encode('%PDF-1.7'))).toBe(true);
    expect(assetFormatOk('form', jpeg)).toBe(false);
    expect(assetFormatOk('photo', new TextEncoder().encode('%PDF-1.7'))).toBe(false);
    expect(assetFormatOk('photo', Uint8Array.from([0xff, 0xd8]))).toBe(false);
  });
});
