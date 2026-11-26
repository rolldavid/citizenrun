import sharp from 'sharp';

// The media asset writer of PIPE-loader-assets: the only module of the load core that imports sharp.

export type MediaObjectStore = {
  exists(key: string): Promise<boolean>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array, contentType: 'image/jpeg' | 'application/pdf'): Promise<void>;
};

export type MediaAssetWriter = {
  readonly store: MediaObjectStore;
  /** sharp(bytes, { failOn: 'warning', limitInputPixels: PHOTO_MAX_INPUT_PIXELS }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true }):
   *  JPEG, metadata stripped (sharp's default; never withMetadata), no resize. Throws on an undecodable file. */
  reencodePhoto(bytes: Uint8Array): Promise<{ jpeg: Uint8Array; width: number; height: number }>;
  /** sharp(bytes).metadata() width and height of a JPEG already in the store. */
  measurePhoto(bytes: Uint8Array): Promise<{ width: number; height: number }>;
};

export const PHOTO_MAX_INPUT_PIXELS = 50_000_000; // PIPE-loader-assets
const PHOTO_JPEG_QUALITY = 85; // PIPE-people-photos

const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // '%PDF-'

export function createMediaAssetWriter(store: MediaObjectStore): MediaAssetWriter {
  return {
    store,
    async reencodePhoto(bytes) {
      const { data, info } = await sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: PHOTO_MAX_INPUT_PIXELS,
      })
        .jpeg({ quality: PHOTO_JPEG_QUALITY })
        .toBuffer({ resolveWithObject: true });
      return { jpeg: new Uint8Array(data), width: info.width, height: info.height };
    },
    async measurePhoto(bytes) {
      const { width, height } = await sharp(bytes, {
        limitInputPixels: PHOTO_MAX_INPUT_PIXELS,
      }).metadata();
      return { width, height };
    },
  };
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte);
}

/** True when the bytes start with FF D8 FF (photo) or with the five bytes '%PDF-' (form). */
export function assetFormatOk(kind: 'photo' | 'form', bytes: Uint8Array): boolean {
  return startsWith(bytes, kind === 'photo' ? JPEG_MAGIC : PDF_MAGIC);
}
