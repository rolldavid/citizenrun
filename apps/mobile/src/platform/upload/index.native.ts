import { PHOTO_MAX_BYTES, UPLOAD_EXTENSIONS } from '@citizenrun/shared';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { fromExpoPermission } from '@/platform/shared';

import { PHOTO_JPEG_QUALITY, PHOTO_JPEG_QUALITY_RETRY, PHOTO_MAX_WIDTH } from './constants';
import { sendWithXhr } from './send';
import type { CropRect, PickOutcome, PickedPhoto, PrepareOutcome, UploadModule } from './types';

// PM-upload on iOS and Android. The picker never crops (D-569): the caller passes the crop.

const PICKER_FAILED: PickOutcome = { kind: 'failed', code: 'upload.picker_failed' };
const ENCODE_FAILED: PrepareOutcome = { kind: 'failed', code: 'upload.encode_failed' };

/** The cache files preparePhoto wrote and release has not deleted yet. */
const written = new Set<string>();

/** The members of expo-file-system's File this module uses. */
type CacheFile = {
  readonly exists: boolean;
  readonly size: number | null;
  delete(): void;
};

function cacheFile(uri: string): CacheFile {
  const file: unknown = new File(uri);
  return file as CacheFile; // the web type-check reads the library's web typing, whose File declares none of these members
}

function exists(uri: string): boolean {
  try {
    return cacheFile(uri).exists;
  } catch {
    return false;
  }
}

function sizeOf(uri: string): number | null {
  try {
    return cacheFile(uri).size;
  } catch {
    return null;
  }
}

function dropFile(uri: string): void {
  try {
    cacheFile(uri).delete();
  } catch {
    // already gone or unreadable: nothing left to free
  }
}

/** True for the library's own report of a missing permission (its error codes name the permission). */
function isPermissionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return typeof error.code === 'string' && error.code.includes('PERMISSION');
}

async function pickAvatarPhoto(): Promise<PickOutcome> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
    if (result.canceled) {
      return { kind: 'cancelled' };
    }
    const asset = result.assets[0];
    if (asset === undefined) {
      return PICKER_FAILED;
    }
    return {
      kind: 'picked',
      items: [
        {
          kind: 'photo',
          previewUri: asset.uri,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType ?? null,
          fileSize: asset.fileSize ?? null,
        },
      ],
      truncated: false,
    };
  } catch (error: unknown) {
    if (!isPermissionError(error)) {
      return PICKER_FAILED;
    }
    try {
      const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
      return { kind: 'denied', state: fromExpoPermission(permission, false) };
    } catch {
      return PICKER_FAILED;
    }
  }
}

/** A resize by width alone: the library keeps the aspect ratio. */
type WidthResize = { resize(size: { width: number }): unknown };

/** Crops (when given) and resizes, never enlarging; null when the platform cannot decode the source. */
async function render(item: PickedPhoto, crop: CropRect | null): Promise<ImageRef | null> {
  try {
    const context = ImageManipulator.manipulate(item.previewUri);
    if (crop) {
      context.crop(crop);
    }
    const width = Math.min(PHOTO_MAX_WIDTH, crop ? crop.width : item.width);
    (context as WidthResize).resize({ width }); // the web type-check reads the library's web typing, which wrongly requires a height
    return await context.renderAsync();
  } catch {
    return null;
  }
}

type Saved = { uri: string; width: number; height: number; size: number };

/** Encodes once as JPEG and measures the file; a file that cannot be measured is deleted and throws. */
async function saveMeasured(image: ImageRef, compress: number): Promise<Saved> {
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress });
  const size = sizeOf(result.uri);
  if (size === null) {
    dropFile(result.uri);
    throw new Error('upload.encode_failed');
  }
  return { uri: result.uri, width: result.width, height: result.height, size };
}

async function preparePhoto(
  item: PickedPhoto,
  opts: { crop: CropRect | null },
): Promise<PrepareOutcome> {
  const image = await render(item, opts.crop);
  if (image === null) {
    return { kind: 'rejected', reason: 'unsupported_format' };
  }
  // The re-encode drops the source's EXIF metadata, location included.
  try {
    let saved = await saveMeasured(image, PHOTO_JPEG_QUALITY);
    if (saved.size > PHOTO_MAX_BYTES) {
      dropFile(saved.uri);
      saved = await saveMeasured(image, PHOTO_JPEG_QUALITY_RETRY);
      if (saved.size > PHOTO_MAX_BYTES) {
        dropFile(saved.uri);
        return { kind: 'rejected', reason: 'photo_too_large' };
      }
    }
    written.add(saved.uri);
    return {
      kind: 'ready',
      file: {
        kind: 'photo',
        contentType: 'image/jpeg',
        size: saved.size,
        width: saved.width,
        height: saved.height,
        durationMs: null,
        previewUri: saved.uri,
      },
    };
  } catch {
    return ENCODE_FAILED;
  }
}

const send: UploadModule['send'] = (file, ticket, opts) => {
  if (!exists(file.previewUri)) {
    return Promise.resolve({ kind: 'failed', code: 'upload.file_missing' });
  }
  // React Native's multipart file form: the file by its URI, with a name and a type
  const part = {
    uri: file.previewUri,
    name: `upload.${UPLOAD_EXTENSIONS[file.contentType]}`,
    type: file.contentType,
  };
  return sendWithXhr(file, ticket, part, opts);
};

const release: UploadModule['release'] = (items) => {
  for (const item of items) {
    // picked originals belong to the picker; only the files preparePhoto wrote are deleted
    if (written.delete(item.previewUri)) {
      dropFile(item.previewUri);
    }
  }
};

export const upload: UploadModule = {
  pickAvatarPhoto,
  preparePhoto,
  send,
  release,
};

export type * from './types';
