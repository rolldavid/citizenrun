import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = [
  'acknowledgeSignificantUpdate',
  'blockGate',
  'evaluateBirthMonth',
  'gateBlockedUntil',
  'requestStoreSignal',
  'significantUpdateAcknowledgmentRequired',
  'storeSignalSupported',
];

const BIRTH_FIXTURE = { year: 2000, month: 1 };
const TODAY_FIXTURE = '2027-01-01';
const NOW_FIXTURE = new Date('2027-01-01T12:00:00.000Z');

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
  expect(error).toMatchObject({
    module: 'age_assurance',
    method,
    code: 'age_assurance.not_ready',
  });
}

describe('age-assurance stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.ageAssurance).sort();
    expect(nativeKeys).toEqual(Object.keys(web.ageAssurance).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.ageAssurance],
    ['index.web', web.ageAssurance],
  ])('%s', (_file, ageAssurance) => {
    it('capability flags are false', () => {
      expect(ageAssurance.storeSignalSupported).toBe(false);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(await rejection(ageAssurance.requestStoreSignal()), 'requestStoreSignal');
      expectNotReady(
        await rejection(ageAssurance.significantUpdateAcknowledgmentRequired()),
        'significantUpdateAcknowledgmentRequired',
      );
      expectNotReady(
        await rejection(ageAssurance.acknowledgeSignificantUpdate()),
        'acknowledgeSignificantUpdate',
      );
    });

    it('synchronous members throw PlatformNotReadyError', () => {
      expectNotReady(
        thrown(() => ageAssurance.evaluateBirthMonth(BIRTH_FIXTURE, TODAY_FIXTURE)),
        'evaluateBirthMonth',
      );
      expectNotReady(
        thrown(() => ageAssurance.gateBlockedUntil()),
        'gateBlockedUntil',
      );
      expectNotReady(
        thrown(() => {
          ageAssurance.blockGate(NOW_FIXTURE);
        }),
        'blockGate',
      );
    });
  });
});
