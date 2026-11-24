import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type { PickedPhoto } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = ['pickAvatarPhoto', 'preparePhoto', 'release'];

const PHOTO_FIXTURE: PickedPhoto = {
  kind: 'photo',
  previewUri: 'file:///fixture/photo.jpg',
  width: 1200,
  height: 900,
  mimeType: 'image/jpeg',
  fileSize: 204800,
};

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error: unknown) {
    return error;
  }
  return null;
}

function expectNotReady(error: unknown, method: string): void {
  expect(error).toBeInstanceOf(PlatformNotReadyError);
  expect(error).toMatchObject({ module: 'upload', method, code: 'upload.not_ready' });
}

describe('upload stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.upload).sort();
    expect(nativeKeys).toEqual(Object.keys(web.upload).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.upload],
    ['index.web', web.upload],
  ])('%s', (_file, upload) => {
    it('capability flags are false', () => {
      const flags = Object.values(upload).filter((value) => typeof value === 'boolean');
      expect(flags).toEqual([]);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(await rejection(upload.pickAvatarPhoto()), 'pickAvatarPhoto');
      expectNotReady(
        await rejection(upload.preparePhoto(PHOTO_FIXTURE, { crop: null })),
        'preparePhoto',
      );
    });

    it('synchronous members throw PlatformNotReadyError', () => {
      expectNotReady(
        thrown(() => {
          upload.release([PHOTO_FIXTURE]);
        }),
        'release',
      );
    });
  });
});
