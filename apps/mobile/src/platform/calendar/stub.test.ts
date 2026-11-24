import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type { CalendarEventInput } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = [
  'addEvents',
  'downloadDeclarationFile',
  'getPermission',
  'oneTapSupported',
  'openSubscribeLink',
  'removeDeclarationEvents',
  'requestPermission',
  'subscribeLink',
  'updatesSupported',
];

const fixtureId = '01890a5d-ac96-774b-bcce-b302099a8057';

const fixtureEvent: CalendarEventInput = {
  declarationId: fixtureId,
  kind: 'deadline',
  date: '2027-03-05',
  title: 'Fixture deadline',
  notes: 'Fixture notes',
  url: 'https://example.test/source',
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
  expect(error).toMatchObject({ module: 'calendar', method, code: 'calendar.not_ready' });
}

describe('calendar stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.calendar).sort();
    expect(nativeKeys).toEqual(Object.keys(web.calendar).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.calendar],
    ['index.web', web.calendar],
  ])('%s', (_file, calendar) => {
    it('capability flags are false', () => {
      expect(calendar.oneTapSupported).toBe(false);
      expect(calendar.updatesSupported).toBe(false);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(await rejection(calendar.getPermission()), 'getPermission');
      expectNotReady(await rejection(calendar.requestPermission()), 'requestPermission');
      expectNotReady(
        await rejection(calendar.addEvents([fixtureEvent], 'Fixture calendar')),
        'addEvents',
      );
      expectNotReady(
        await rejection(calendar.removeDeclarationEvents(fixtureId)),
        'removeDeclarationEvents',
      );
      expectNotReady(
        await rejection(calendar.openSubscribeLink('webcal://example.test/feed.ics')),
        'openSubscribeLink',
      );
    });

    it('synchronous members throw PlatformNotReadyError', () => {
      expectNotReady(
        thrown(() => calendar.downloadDeclarationFile(fixtureId)),
        'downloadDeclarationFile',
      );
      expectNotReady(
        thrown(() =>
          calendar.subscribeLink({
            url: 'https://example.test/f.ics',
            webcalUrl: 'webcal://example.test/f.ics',
          }),
        ),
        'subscribeLink',
      );
    });
  });
});
