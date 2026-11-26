import { PHOTO_MAX_BYTES } from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import webSource from './index.web.ts?raw';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';
import type { CropRect, PickedPhoto } from './types';

type Op = [string, ...unknown[]];

/** The manipulator's chain recorder and the scripted file sizes of each saved output. */
const lab = vi.hoisted(() => ({
  ops: [] as Op[],
  renderFails: false,
  saveFails: false,
  saves: 0,
  scheme: 'file:///cache/',
  sizes: [] as number[],
  sizeOf: new Map<string, number>(),
  deleted: [] as string[],
  released: [] as string[],
}));

vi.mock('expo-image-manipulator', () => {
  function manipulate(uri: string): unknown {
    lab.ops.push(['manipulate', uri]);
    const context = {
      release() {
        lab.released.push('context');
      },
      crop(rect: unknown) {
        lab.ops.push(['crop', rect]);
        return context;
      },
      resize(size: unknown) {
        lab.ops.push(['resize', size]);
        return context;
      },
      renderAsync() {
        lab.ops.push(['renderAsync']);
        if (lab.renderFails) {
          return Promise.reject(new Error('fixture decode failure'));
        }
        return Promise.resolve({
          release() {
            lab.released.push('image');
          },
          saveAsync(options: unknown) {
            lab.ops.push(['saveAsync', options]);
            if (lab.saveFails) {
              return Promise.reject(new Error('fixture encode failure'));
            }
            lab.saves += 1;
            const uri = `${lab.scheme}fixture-out-${String(lab.saves)}.jpg`;
            lab.sizeOf.set(uri, lab.sizes[lab.saves - 1] ?? 400_000);
            return Promise.resolve({ uri, width: 1080, height: 1080 });
          },
        });
      },
    };
    return context;
  }
  return {
    SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
    ImageManipulator: { manipulate },
  };
});

vi.mock('expo-file-system', () => {
  class File {
    readonly uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists(): boolean {
      return lab.sizeOf.has(this.uri) && !lab.deleted.includes(this.uri);
    }
    get size(): number | null {
      return lab.sizeOf.get(this.uri) ?? null;
    }
    delete(): void {
      lab.deleted.push(this.uri);
    }
  }
  return { File };
});

vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
  getMediaLibraryPermissionsAsync: vi.fn(),
}));

const LANDSCAPE: PickedPhoto = {
  kind: 'photo',
  previewUri: 'file:///picker/fixture-landscape.heic',
  width: 2000,
  height: 1500,
  mimeType: 'image/heic',
  fileSize: 3_000_000,
};
const CENTRED_SQUARE: CropRect = { originX: 250, originY: 0, width: 1500, height: 1500 };

beforeEach(() => {
  lab.ops = [];
  lab.renderFails = false;
  lab.saveFails = false;
  lab.saves = 0;
  lab.scheme = 'file:///cache/';
  lab.sizes = [];
  lab.sizeOf.clear();
  lab.deleted = [];
  lab.released = [];
});

async function nativeUpload(): Promise<(typeof NativeIndex)['upload']> {
  vi.resetModules();
  return (await vi.importActual<typeof NativeIndex>('./index.native')).upload;
}

describe('preparePhoto on phones', () => {
  it('crop, resize, JPEG', async () => {
    const upload = await nativeUpload();
    const outcome = await upload.preparePhoto(LANDSCAPE, { crop: CENTRED_SQUARE });
    expect(lab.ops).toEqual([
      ['manipulate', LANDSCAPE.previewUri],
      ['crop', CENTRED_SQUARE],
      ['resize', { width: 1080 }],
      ['renderAsync'],
      ['saveAsync', { format: 'jpeg', compress: 0.85 }],
    ]);
    expect(outcome).toEqual({
      kind: 'ready',
      file: {
        kind: 'photo',
        contentType: 'image/jpeg',
        size: 400_000,
        width: 1080,
        height: 1080,
        durationMs: null,
        previewUri: 'file:///cache/fixture-out-1.jpg',
      },
    });
  });

  it('never enlarged', async () => {
    const upload = await nativeUpload();
    await upload.preparePhoto({ ...LANDSCAPE, width: 600, height: 450 }, { crop: null });
    expect(lab.ops.filter(([op]) => op === 'crop')).toEqual([]);
    expect(lab.ops).toContainEqual(['resize', { width: 600 }]);

    lab.ops = [];
    await upload.preparePhoto(LANDSCAPE, {
      crop: { originX: 0, originY: 0, width: 800, height: 800 },
    });
    expect(lab.ops).toContainEqual(['resize', { width: 800 }]);
  });

  it('retry at 0.7', async () => {
    lab.sizes = [9_000_000, 7_000_000];
    const upload = await nativeUpload();
    const outcome = await upload.preparePhoto(LANDSCAPE, { crop: CENTRED_SQUARE });
    expect(lab.ops.filter(([op]) => op === 'saveAsync')).toEqual([
      ['saveAsync', { format: 'jpeg', compress: 0.85 }],
      ['saveAsync', { format: 'jpeg', compress: 0.7 }],
    ]);
    expect(lab.deleted).toEqual(['file:///cache/fixture-out-1.jpg']);
    expect(outcome).toMatchObject({
      kind: 'ready',
      file: { size: 7_000_000, previewUri: 'file:///cache/fixture-out-2.jpg' },
    });
  });

  it('too large', async () => {
    lab.sizes = [PHOTO_MAX_BYTES + 1, PHOTO_MAX_BYTES + 1];
    const upload = await nativeUpload();
    const outcome = await upload.preparePhoto(LANDSCAPE, { crop: CENTRED_SQUARE });
    expect(outcome).toEqual({ kind: 'rejected', reason: 'photo_too_large' });
    expect(lab.deleted).toEqual([
      'file:///cache/fixture-out-1.jpg',
      'file:///cache/fixture-out-2.jpg',
    ]);
  });

  it('exactly the limit is kept', async () => {
    lab.sizes = [PHOTO_MAX_BYTES];
    const upload = await nativeUpload();
    const outcome = await upload.preparePhoto(LANDSCAPE, { crop: CENTRED_SQUARE });
    expect(outcome).toMatchObject({ kind: 'ready', file: { size: PHOTO_MAX_BYTES } });
    expect(lab.saves).toBe(1);
  });

  it('cannot decode', async () => {
    lab.renderFails = true;
    const upload = await nativeUpload();
    await expect(upload.preparePhoto(LANDSCAPE, { crop: null })).resolves.toEqual({
      kind: 'rejected',
      reason: 'unsupported_format',
    });
  });

  it('cannot encode', async () => {
    lab.saveFails = true;
    const upload = await nativeUpload();
    await expect(upload.preparePhoto(LANDSCAPE, { crop: null })).resolves.toEqual({
      kind: 'failed',
      code: 'upload.encode_failed',
    });
  });

  it('release deletes only what preparing wrote, once', async () => {
    const upload = await nativeUpload();
    const outcome = await upload.preparePhoto(LANDSCAPE, { crop: CENTRED_SQUARE });
    if (outcome.kind !== 'ready') {
      throw new Error('the fixture photo was not prepared');
    }
    upload.release([LANDSCAPE, outcome.file]);
    upload.release([LANDSCAPE, outcome.file]);
    expect(lab.deleted).toEqual([outcome.file.previewUri]);
  });
});

describe('preparePhoto on the web', () => {
  let revoked: string[] = [];

  beforeEach(() => {
    lab.scheme = 'blob:fixture/';
    vi.stubGlobal(
      'fetch',
      vi.fn((uri: string) =>
        Promise.resolve(new Response(new Uint8Array(lab.sizeOf.get(uri) ?? 0))),
      ),
    );
    revoked = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((uri: string) => {
      revoked.push(uri);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function webUpload(): Promise<(typeof WebIndex)['upload']> {
    vi.resetModules();
    return (await vi.importActual<typeof WebIndex>('./index.web')).upload;
  }

  it('the same chain, measured from the blob', async () => {
    lab.sizes = [9_000_000, 7_000_000];
    const upload = await webUpload();
    const outcome = await upload.preparePhoto(LANDSCAPE, { crop: CENTRED_SQUARE });
    expect(lab.ops).toEqual([
      ['manipulate', LANDSCAPE.previewUri],
      ['crop', CENTRED_SQUARE],
      ['resize', { width: 1080 }],
      ['renderAsync'],
      ['saveAsync', { format: 'jpeg', compress: 0.85 }],
      ['saveAsync', { format: 'jpeg', compress: 0.7 }],
    ]);
    expect(revoked).toEqual(['blob:fixture/fixture-out-1.jpg']);
    expect(outcome).toMatchObject({
      kind: 'ready',
      file: { size: 7_000_000, previewUri: 'blob:fixture/fixture-out-2.jpg' },
    });

    if (outcome.kind === 'ready') {
      upload.release([outcome.file]);
      upload.release([outcome.file]);
    }
    expect(revoked).toEqual(['blob:fixture/fixture-out-1.jpg', 'blob:fixture/fixture-out-2.jpg']);
  });

  it('too large on the web', async () => {
    lab.sizes = [PHOTO_MAX_BYTES + 1, PHOTO_MAX_BYTES + 1];
    const upload = await webUpload();
    await expect(upload.preparePhoto(LANDSCAPE, { crop: null })).resolves.toEqual({
      kind: 'rejected',
      reason: 'photo_too_large',
    });
    expect(revoked).toEqual(['blob:fixture/fixture-out-1.jpg', 'blob:fixture/fixture-out-2.jpg']);
  });

  it('cannot decode on the web', async () => {
    lab.renderFails = true;
    const upload = await webUpload();
    await expect(upload.preparePhoto(LANDSCAPE, { crop: null })).resolves.toEqual({
      kind: 'rejected',
      reason: 'unsupported_format',
    });
  });

  it('releases the rendered image and its context, whatever the outcome', async () => {
    const upload = await webUpload();
    await upload.preparePhoto(LANDSCAPE, { crop: CENTRED_SQUARE });
    expect(lab.released.sort()).toEqual(['context', 'image']);

    lab.released = [];
    lab.sizes = [PHOTO_MAX_BYTES + 1, PHOTO_MAX_BYTES + 1];
    lab.saves = 0;
    await upload.preparePhoto(LANDSCAPE, { crop: null });
    expect(lab.released.sort()).toEqual(['context', 'image']);

    lab.released = [];
    lab.saveFails = true;
    await upload.preparePhoto(LANDSCAPE, { crop: null });
    expect(lab.released.sort()).toEqual(['context', 'image']);

    lab.released = [];
    lab.renderFails = true;
    await upload.preparePhoto(LANDSCAPE, { crop: null });
    expect(lab.released).toEqual(['context']);
  });

  it('web loads the manipulator on demand', () => {
    expect(webSource).toContain("import('expo-image-manipulator')");
    expect(webSource).not.toContain("from 'expo-image-manipulator'");
  });
});
