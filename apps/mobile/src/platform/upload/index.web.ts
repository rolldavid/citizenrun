import { PHOTO_MAX_BYTES } from '@citizenrun/shared';
import * as ImagePicker from 'expo-image-picker';

import { fromExpoPermission } from '@/platform/shared';

import { PHOTO_JPEG_QUALITY, PHOTO_JPEG_QUALITY_RETRY, PHOTO_MAX_WIDTH } from './constants';
import { sendWithXhr } from './send';
import type { CropRect, PickOutcome, PickedPhoto, PrepareOutcome, UploadModule } from './types';

// PM-upload on the web. The picker opens the browser's file input, which needs the user's gesture:
// nothing is awaited before it. The image manipulator is loaded on demand, so it is never in a
// route's first chunk (D-182). The picker never crops (D-569): the caller passes the crop.

const PICKER_FAILED: PickOutcome = { kind: 'failed', code: 'upload.picker_failed' };
const ENCODE_FAILED: PrepareOutcome = { kind: 'failed', code: 'upload.encode_failed' };

/** The picked `File` and the prepared `Blob` of each URI this module handed out, until release. */
const files = new Map<string, Blob>();

function forget(uri: string): void {
  if (files.delete(uri) && uri.startsWith('blob:')) {
    URL.revokeObjectURL(uri);
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
    if (asset.file !== undefined) {
      files.set(asset.uri, asset.file);
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

function loadManipulator() {
  return import('expo-image-manipulator');
}

type Manipulator = Awaited<ReturnType<typeof loadManipulator>>;
type Rendered = Awaited<
  ReturnType<ReturnType<Manipulator['ImageManipulator']['manipulate']>['renderAsync']>
>;
type Saved = { uri: string; width: number; height: number; blob: Blob };
/** A resize by width alone: the library keeps the aspect ratio. */
type WidthResize = { resize(size: { width: number }): unknown };

/** Crops (when given) and resizes, never enlarging; null when the browser cannot decode the source. */
async function render(
  lib: Manipulator,
  item: PickedPhoto,
  crop: CropRect | null,
): Promise<Rendered | null> {
  try {
    const context = lib.ImageManipulator.manipulate(item.previewUri);
    if (crop) {
      context.crop(crop);
    }
    const width = Math.min(PHOTO_MAX_WIDTH, crop ? crop.width : item.width);
    (context as WidthResize).resize({ width }); // the library's web typing requires a height, but its web resize derives a missing one from the aspect ratio
    return await context.renderAsync();
  } catch {
    return null;
  }
}

/** Encodes once as JPEG and reads the output's blob; an output that cannot be read is revoked and throws. */
async function saveMeasured(lib: Manipulator, image: Rendered, compress: number): Promise<Saved> {
  const result = await image.saveAsync({ format: lib.SaveFormat.JPEG, compress });
  try {
    const blob = await (await fetch(result.uri)).blob();
    return { uri: result.uri, width: result.width, height: result.height, blob };
  } catch (error: unknown) {
    URL.revokeObjectURL(result.uri);
    throw error;
  }
}

async function preparePhoto(
  item: PickedPhoto,
  opts: { crop: CropRect | null },
): Promise<PrepareOutcome> {
  const lib = await loadManipulator().catch(() => null);
  if (lib === null) {
    return ENCODE_FAILED;
  }
  const image = await render(lib, item, opts.crop);
  if (image === null) {
    return { kind: 'rejected', reason: 'unsupported_format' };
  }
  // The re-encode drops the source's EXIF metadata, location included.
  try {
    let saved = await saveMeasured(lib, image, PHOTO_JPEG_QUALITY);
    if (saved.blob.size > PHOTO_MAX_BYTES) {
      URL.revokeObjectURL(saved.uri);
      saved = await saveMeasured(lib, image, PHOTO_JPEG_QUALITY_RETRY);
      if (saved.blob.size > PHOTO_MAX_BYTES) {
        URL.revokeObjectURL(saved.uri);
        return { kind: 'rejected', reason: 'photo_too_large' };
      }
    }
    files.set(saved.uri, saved.blob);
    return {
      kind: 'ready',
      file: {
        kind: 'photo',
        contentType: 'image/jpeg',
        size: saved.blob.size,
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
  const blob = files.get(file.previewUri);
  if (blob === undefined) {
    return Promise.resolve({ kind: 'failed', code: 'upload.file_missing' });
  }
  return sendWithXhr(file, ticket, blob, opts);
};

const release: UploadModule['release'] = (items) => {
  for (const item of items) {
    forget(item.previewUri);
  }
};

export const upload: UploadModule = {
  pickAvatarPhoto,
  preparePhoto,
  send,
  release,
};

export type * from './types';
