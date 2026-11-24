import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = ['getCurrentPosition', 'getPermission', 'requestPermission', 'supported'];
const PROMISE_MEMBERS = ['getCurrentPosition', 'getPermission', 'requestPermission'];

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function expectNotReady(error: unknown, method: string): void {
  expect(error).toBeInstanceOf(PlatformNotReadyError);
  expect(error).toMatchObject({ module: 'location', method, code: 'location.not_ready' });
}

describe('location stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.location).sort();
    expect(nativeKeys).toEqual(Object.keys(web.location).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.location],
    ['index.web', web.location],
  ])('%s', (_file, location) => {
    it('capability flags are false', () => {
      expect(location.supported).toBe(false);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(await rejection(location.getPermission()), 'getPermission');
      expectNotReady(await rejection(location.requestPermission()), 'requestPermission');
      expectNotReady(await rejection(location.getCurrentPosition()), 'getCurrentPosition');
    });

    it('has no synchronous members', () => {
      const functionMembers = Object.entries(location)
        .filter(([, value]) => typeof value === 'function')
        .map(([name]) => name)
        .sort();
      expect(functionMembers).toEqual(PROMISE_MEMBERS);
    });
  });
});
