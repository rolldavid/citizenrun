import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type { FormFillValues, PdfDocumentHandle } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = [
  'discard',
  'forgetRemembered',
  'loadRemembered',
  'output',
  'outputs',
  'remember',
  'rememberSupported',
];

const fixtureHandle: PdfDocumentHandle = {
  id: 'fixture-document',
  fileName: 'Fixture-form.pdf',
  byteLength: 1024,
};

const fixtureValues: FormFillValues = {
  name: 'Fixture Runner',
  address: null,
  office: 'Fixture office',
  district: null,
  election_date: '2027-11-02',
  party: null,
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
  expect(error).toMatchObject({ module: 'pdf', method, code: 'pdf.not_ready' });
}

describe('pdf stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.pdf).sort();
    expect(nativeKeys).toEqual(Object.keys(web.pdf).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.pdf],
    ['index.web', web.pdf],
  ])('%s', (_file, pdf) => {
    it('capability flags are false', () => {
      expect(pdf.rememberSupported).toBe(false);
      expect(Object.keys(pdf.outputs).sort()).toEqual(['download', 'preview', 'print', 'share']);
      expect(Object.values(pdf.outputs)).toEqual([false, false, false, false]);
    });

    it('promise members reject with PlatformNotReadyError', async () => {
      expectNotReady(await rejection(pdf.output(fixtureHandle, 'preview')), 'output');
      expectNotReady(await rejection(pdf.remember(fixtureValues)), 'remember');
      expectNotReady(await rejection(pdf.loadRemembered()), 'loadRemembered');
      expectNotReady(await rejection(pdf.forgetRemembered()), 'forgetRemembered');
    });

    it('synchronous members throw PlatformNotReadyError', () => {
      expectNotReady(
        thrown(() => {
          pdf.discard(fixtureHandle);
        }),
        'discard',
      );
    });
  });
});
