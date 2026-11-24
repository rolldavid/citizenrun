import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type { PushChannelId } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = [
  'deviceTimezone',
  'getPermission',
  'getToken',
  'initialize',
  'onOpen',
  'register',
  'requestPermission',
  'supported',
  'takeLaunchData',
];

const CHANNEL_NAMES_FIXTURE: Readonly<Record<PushChannelId, string>> = {
  social: 'fixture-social',
  messages: 'fixture-messages',
  civic: 'fixture-civic',
  deadlines: 'fixture-deadlines',
  account: 'fixture-account',
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
  expect(error).toMatchObject({ module: 'push', method, code: 'push.not_ready' });
}

describe('push stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.push).sort();
    expect(nativeKeys).toEqual(Object.keys(web.push).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.push],
    ['index.web', web.push],
  ])('%s', (_file, push) => {
    it('capability flags are false', () => {
      expect(push.supported).toBe(false);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(await rejection(push.initialize(CHANNEL_NAMES_FIXTURE)), 'initialize');
      expectNotReady(await rejection(push.getPermission()), 'getPermission');
      expectNotReady(await rejection(push.requestPermission()), 'requestPermission');
      expectNotReady(await rejection(push.register()), 'register');
      expectNotReady(await rejection(push.getToken()), 'getToken');
      expectNotReady(await rejection(push.takeLaunchData()), 'takeLaunchData');
    });

    it('synchronous members throw PlatformNotReadyError', () => {
      expectNotReady(
        thrown(() => push.deviceTimezone()),
        'deviceTimezone',
      );
      expectNotReady(
        thrown(() => push.onOpen(() => undefined)),
        'onOpen',
      );
    });
  });
});
