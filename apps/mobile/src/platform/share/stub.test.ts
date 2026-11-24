import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type { PreparedShare } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = [
  'copyLink',
  'copySupported',
  'nativeSheetSupported',
  'prepare',
  'release',
  'shareLink',
];

const fixturePrepared: PreparedShare = {
  id: 'fixture-share',
  request: { kind: 'link', url: 'https://example.test/p/1', title: 'Fixture' },
  hasImage: false,
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
  expect(error).toMatchObject({ module: 'share', method, code: 'share.not_ready' });
}

describe('share stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.share).sort();
    expect(nativeKeys).toEqual(Object.keys(web.share).sort());
    expect(nativeKeys).toEqual(MEMBERS);
    for (const later of ['downloadImage', 'downloadSupported', 'shareImage']) {
      expect(nativeKeys).not.toContain(later);
    }
  });

  describe.each([
    ['index.native', native.share],
    ['index.web', web.share],
  ])('%s', (_file, share) => {
    it('capability flags are false', () => {
      expect(share.nativeSheetSupported).toBe(false);
      expect(share.copySupported).toBe(false);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(
        await rejection(
          share.prepare({ kind: 'link', url: 'https://example.test/p/1', title: 'Fixture' }),
        ),
        'prepare',
      );
      expectNotReady(await rejection(share.shareLink(fixturePrepared)), 'shareLink');
      expectNotReady(await rejection(share.copyLink(fixturePrepared)), 'copyLink');
    });

    it('synchronous members throw PlatformNotReadyError', () => {
      expectNotReady(
        thrown(() => {
          share.release(fixturePrepared);
        }),
        'release',
      );
    });
  });
});
