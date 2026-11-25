import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';
import type { AgeAssurance } from './types';

const lib = vi.hoisted(() => ({
  imported: 0,
  getRequiredRegulatoryFeaturesAsync: vi.fn<() => Promise<string[] | null>>(),
  isEligibleForAgeFeaturesAsync: vi.fn<() => Promise<boolean | null>>(),
  requestAgeRangeAsync: vi.fn<(options: { threshold1: number }) => Promise<unknown>>(),
  requestAgeSignalsAccessAsync: vi.fn<() => Promise<string | null>>(),
  showSignificantUpdateAcknowledgmentAsync: vi.fn<(description: string) => Promise<void>>(),
}));
const rn = vi.hoisted(() => ({
  Platform: { OS: 'ios' },
  Linking: { getInitialURL: vi.fn<() => Promise<string | null>>() },
}));

/** The library's mocked module; each evaluation counts as one import of it. */
const libraryModule = vi.hoisted(() => () => {
  lib.imported += 1;
  return {
    getRequiredRegulatoryFeaturesAsync: lib.getRequiredRegulatoryFeaturesAsync,
    isEligibleForAgeFeaturesAsync: lib.isEligibleForAgeFeaturesAsync,
    requestAgeRangeAsync: lib.requestAgeRangeAsync,
    requestAgeSignalsAccessAsync: lib.requestAgeSignalsAccessAsync,
    showSignificantUpdateAcknowledgmentAsync: lib.showSignificantUpdateAcknowledgmentAsync,
  };
});

vi.mock('expo-age-range', libraryModule);
// The production variant: the development fake signal plays no part here (fake-signal.test.ts).
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'production' } } },
}));
vi.mock('react-native', () => rn);

const LIBRARY = [
  lib.getRequiredRegulatoryFeaturesAsync,
  lib.isEligibleForAgeFeaturesAsync,
  lib.requestAgeRangeAsync,
  lib.requestAgeSignalsAccessAsync,
  lib.showSignificantUpdateAcknowledgmentAsync,
];
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;

async function loadNative(os: 'ios' | 'android'): Promise<AgeAssurance> {
  rn.Platform.OS = os;
  vi.resetModules();
  return (await vi.importActual<typeof NativeIndex>('./index.native')).ageAssurance;
}

async function loadWeb(): Promise<AgeAssurance> {
  vi.resetModules();
  return (await vi.importActual<typeof WebIndex>('./index.web')).ageAssurance;
}

let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  for (const fn of LIBRARY) {
    fn.mockReset();
  }
  lib.imported = 0;
  lib.requestAgeSignalsAccessAsync.mockResolvedValue('SHARED');
  lib.isEligibleForAgeFeaturesAsync.mockResolvedValue(true);
  lib.requestAgeRangeAsync.mockResolvedValue({
    lowerBound: 18,
    upperBound: null,
    ageRangeDeclaration: 'selfDeclared',
  });
  lib.getRequiredRegulatoryFeaturesAsync.mockResolvedValue(null);
  lib.showSignificantUpdateAcknowledgmentAsync.mockResolvedValue(undefined);
  consoleSpies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
});

// nothing is logged: no case of this file may reach the console
afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
});

describe('age assurance on phones', () => {
  it('android asks for access first', async () => {
    lib.requestAgeRangeAsync.mockResolvedValue({
      lowerBound: 18,
      upperBound: null,
      ageRangeSource: 'TIER_C',
    });
    const ageAssurance = await loadNative('android');
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({
      kind: 'adult',
      tier: 'confirmed',
    });
    const access = lib.requestAgeSignalsAccessAsync.mock.invocationCallOrder[0];
    const range = lib.requestAgeRangeAsync.mock.invocationCallOrder[0];
    expect(access).toBeDefined();
    expect(range).toBeDefined();
    expect(Number(access)).toBeLessThan(Number(range));
    expect(lib.isEligibleForAgeFeaturesAsync).not.toHaveBeenCalled();

    for (const refusal of ['NOT_SHARED', 'VERIFICATION_REQUIRED', null]) {
      lib.requestAgeRangeAsync.mockClear();
      lib.requestAgeSignalsAccessAsync.mockResolvedValue(refusal);
      await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
      expect(lib.requestAgeRangeAsync).not.toHaveBeenCalled();
    }

    lib.requestAgeSignalsAccessAsync.mockRejectedValue(new Error('-6'));
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
    expect(lib.requestAgeRangeAsync).not.toHaveBeenCalled();
  });

  it('threshold 18', async () => {
    for (const os of ['ios', 'android'] as const) {
      lib.requestAgeRangeAsync.mockClear();
      const ageAssurance = await loadNative(os);
      await ageAssurance.requestStoreSignal();
      expect(lib.requestAgeRangeAsync).toHaveBeenCalledTimes(1);
      expect(lib.requestAgeRangeAsync).toHaveBeenCalledWith({ threshold1: 18 });
    }
  });

  it('the store answer is mapped', async () => {
    lib.requestAgeRangeAsync.mockResolvedValue({
      lowerBound: 0,
      upperBound: 12,
      ageRangeDeclaration: 'guardianDeclared',
    });
    const ageAssurance = await loadNative('ios');
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: true,
    });
  });

  it('a library error is unavailable', async () => {
    for (const os of ['ios', 'android'] as const) {
      const ageAssurance = await loadNative(os);
      lib.requestAgeRangeAsync.mockRejectedValue(new Error('ERR_AGE_RANGE_NOT_AVAILABLE'));
      await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
      lib.requestAgeRangeAsync.mockImplementation(() => {
        throw new Error('fixture synchronous failure');
      });
      await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
    }
  });

  it('declined is unavailable', async () => {
    // iOS reports a declined prompt as a rejection
    lib.requestAgeRangeAsync.mockRejectedValue(
      Object.assign(new Error('declined'), { code: 'ERR_AGE_RANGE_USER_DECLINED' }),
    );
    const ageAssurance = await loadNative('ios');
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('ios not eligible', async () => {
    const ageAssurance = await loadNative('ios');
    lib.isEligibleForAgeFeaturesAsync.mockResolvedValue(false);
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
    expect(lib.requestAgeRangeAsync).not.toHaveBeenCalled();

    lib.isEligibleForAgeFeaturesAsync.mockRejectedValue(new Error('ERR_AGE_RANGE_NOT_AVAILABLE'));
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
    expect(lib.requestAgeRangeAsync).not.toHaveBeenCalled();

    // null (before iOS 26.2) is unknown, so the store is asked
    lib.isEligibleForAgeFeaturesAsync.mockResolvedValue(null);
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({
      kind: 'adult',
      tier: 'declared',
    });
    expect(lib.requestAgeRangeAsync).toHaveBeenCalledTimes(1);
  });

  it('the old-iOS default answer is unavailable', async () => {
    lib.requestAgeRangeAsync.mockResolvedValue({ lowerBound: 18, upperBound: null });
    const ageAssurance = await loadNative('ios');
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
  });

  it('acknowledgment on ios only', async () => {
    const ios = await loadNative('ios');
    expect(ios.storeSignalSupported).toBe(true);
    lib.getRequiredRegulatoryFeaturesAsync.mockResolvedValue([
      'declaredAgeRangeRequired',
      'significantAppChangeRequiresAdultNotification',
    ]);
    await expect(ios.significantUpdateAcknowledgmentRequired()).resolves.toBe(true);
    await expect(ios.acknowledgeSignificantUpdate()).resolves.toBeUndefined();
    expect(lib.showSignificantUpdateAcknowledgmentAsync).toHaveBeenCalledTimes(1);

    lib.getRequiredRegulatoryFeaturesAsync.mockResolvedValue([
      'declaredAgeRangeRequired',
      'significantAppChangeRequiresParentalConsent',
    ]);
    await expect(ios.significantUpdateAcknowledgmentRequired()).resolves.toBe(false);
    lib.getRequiredRegulatoryFeaturesAsync.mockResolvedValue(null);
    await expect(ios.significantUpdateAcknowledgmentRequired()).resolves.toBe(false);
    lib.getRequiredRegulatoryFeaturesAsync.mockRejectedValue(new Error('fixture failure'));
    await expect(ios.significantUpdateAcknowledgmentRequired()).resolves.toBe(false);
    lib.showSignificantUpdateAcknowledgmentAsync.mockRejectedValue(new Error('fixture failure'));
    await expect(ios.acknowledgeSignificantUpdate()).resolves.toBeUndefined();

    lib.getRequiredRegulatoryFeaturesAsync.mockReset();
    lib.showSignificantUpdateAcknowledgmentAsync.mockReset();
    const android = await loadNative('android');
    expect(android.storeSignalSupported).toBe(true);
    await expect(android.significantUpdateAcknowledgmentRequired()).resolves.toBe(false);
    await expect(android.acknowledgeSignificantUpdate()).resolves.toBeUndefined();
    expect(lib.getRequiredRegulatoryFeaturesAsync).not.toHaveBeenCalled();
    expect(lib.showSignificantUpdateAcknowledgmentAsync).not.toHaveBeenCalled();
  });

  it('nothing of the result is returned beyond the outcome', async () => {
    lib.requestAgeRangeAsync.mockResolvedValue({
      lowerBound: 18,
      upperBound: null,
      ageRangeDeclaration: 'confirmed',
      activeParentalControls: ['communicationLimits'],
    });
    const ageAssurance = await loadNative('ios');
    const outcome = await ageAssurance.requestStoreSignal();
    expect(outcome).toEqual({ kind: 'adult', tier: 'confirmed' });
    expect(Object.keys(outcome).sort()).toEqual(['kind', 'tier']);
  });
});

describe('age assurance on the web', () => {
  it('web', async () => {
    // a fresh factory, so the count starts with this case's own loads
    vi.doMock('expo-age-range', libraryModule);
    lib.imported = 0;
    const ageAssurance = await loadWeb();
    expect(lib.imported).toBe(0);
    expect(ageAssurance.storeSignalSupported).toBe(false);
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({ kind: 'unavailable' });
    await expect(ageAssurance.significantUpdateAcknowledgmentRequired()).resolves.toBe(false);
    await expect(ageAssurance.acknowledgeSignificantUpdate()).resolves.toBeUndefined();
    for (const fn of LIBRARY) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(lib.imported).toBe(0);

    // the probe works: loading the phone file reaches the library module
    await loadNative('ios');
    expect(lib.imported).toBe(1);
  });
});
