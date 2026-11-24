import type { PermissionState } from '../shared';
export type { PermissionState } from '../shared';

export type PickedPhoto = {
  kind: 'photo';
  previewUri: string; // a file:// URI on phones, a blob: URL on the web; usable as an image source
  width: number; // pixels, after orientation
  height: number;
  mimeType: string | null;
  fileSize: number | null; // bytes, when the picker reports it
};
export type PickedMedia = PickedPhoto;

export type PickOutcome =
  | { kind: 'picked'; items: readonly PickedMedia[]; truncated: boolean } // truncated: more than 10 photos were chosen; the first 10 are kept (D-175)
  | { kind: 'cancelled' }
  | { kind: 'denied'; state: PermissionState }
  | { kind: 'failed'; code: UploadErrorCode };

/** A crop in source pixels, after orientation. */
export type CropRect = { originX: number; originY: number; width: number; height: number };

export type PreparedFile = {
  kind: 'photo' | 'video';
  contentType: 'image/jpeg';
  size: number; // bytes: the `size` the caller sends to E-UPL-01
  width: number;
  height: number;
  durationMs: number | null; // videos only
  previewUri: string;
};

export type PrepareOutcome =
  | { kind: 'ready'; file: PreparedFile }
  | { kind: 'rejected'; reason: 'photo_too_large' | 'unsupported_format' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: UploadErrorCode };

export type SendProgress = { sentBytes: number; totalBytes: number };

export type SendOutcome =
  | { kind: 'sent'; key: string } // the ticket's key, to attach
  | { kind: 'expired' } // the policy's 300 seconds passed before the request started; ask for a new ticket
  | { kind: 'refused'; status: number } // the bucket refused the body (size or type outside the policy, D-248)
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: UploadErrorCode };

export type UploadErrorCode =
  | 'upload.picker_failed'
  | 'upload.decode_failed'
  | 'upload.encode_failed'
  | 'upload.compress_failed'
  | 'upload.file_missing'
  | 'upload.network';

export interface UploadModule {
  // PM-upload
  /** One photo from the library, uncropped: the caller passes the crop to preparePhoto on every platform (D-175, D-547). */
  pickAvatarPhoto(): Promise<PickOutcome>;
  /** Crops (when given), resizes to at most 1080 pixels wide and re-encodes as JPEG (D-175). */
  preparePhoto(item: PickedPhoto, opts: { crop: CropRect | null }): Promise<PrepareOutcome>;
  /** Frees what picking and preparing made (cache files, blob URLs). Safe to call twice. */
  release(items: readonly (PickedMedia | PreparedFile)[]): void;
}
