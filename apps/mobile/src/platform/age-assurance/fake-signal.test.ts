import { brandVariant } from '@citizenrun/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeOutcomeFromUrl } from './fake-signal';
import type * as NativeIndex from './index.native';
import type { AgeAssurance } from './types';

const lib = vi.hoisted(() => ({
  getRequiredRegulatoryFeaturesAsync: vi.fn(),
  isEligibleForAgeFeaturesAsync: vi.fn(),
  requestAgeRangeAsync: vi.fn(),
  requestAgeSignalsAccessAsync: vi.fn(),
  showSignificantUpdateAcknowledgmentAsync: vi.fn(),
}));
const constants = vi.hoisted(() => ({
  expoConfig: null as { extra?: Record<string, unknown> } | null,
}));
const rn = vi.hoisted(() => ({
  Platform: { OS: 'ios' },
  Linking: { getInitialURL: vi.fn<() => Promise<string | null>>() },
}));

vi.mock('expo-age-range', () => lib);
vi.mock('expo-constants', () => ({ default: constants }));
vi.mock('react-native', () => rn);

const SCHEME = brandVariant('development').scheme;
const ADULT_LINK = `${SCHEME}://welcome?fakeAgeSignal=adult`;

async function loadNative(): Promise<AgeAssurance> {
  vi.resetModules();
  return (await vi.importActual<typeof NativeIndex>('./index.native')).ageAssurance;
}

function libraryCalls(): number {
  return Object.values(lib).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

beforeEach(() => {
  for (const fn of Object.values(lib)) {
    fn.mockReset();
  }
  rn.Platform.OS = 'ios';
  rn.Linking.getInitialURL.mockReset();
  rn.Linking.getInitialURL.mockResolvedValue(ADULT_LINK);
  lib.isEligibleForAgeFeaturesAsync.mockResolvedValue(true);
  lib.requestAgeRangeAsync.mockResolvedValue({
    lowerBound: 0,
    upperBound: 17,
    ageRangeDeclaration: 'confirmed',
  });
});

describe('the development fake signal', () => {
  it('the development variant reads the deep link', async () => {
    constants.expoConfig = { extra: { variant: 'development' } };
    const ageAssurance = await loadNative();
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({
      kind: 'adult',
      tier: 'declared',
    });
    expect(rn.Linking.getInitialURL).toHaveBeenCalledTimes(1);
    expect(libraryCalls()).toBe(0);
  });

  it('each fake value', () => {
    const link = (value: string): string => `${SCHEME}://welcome?fakeAgeSignal=${value}`;
    expect(fakeOutcomeFromUrl(link('adult'))).toEqual({ kind: 'adult', tier: 'declared' });
    expect(fakeOutcomeFromUrl(link('adult_confirmed'))).toEqual({
      kind: 'adult',
      tier: 'confirmed',
    });
    expect(fakeOutcomeFromUrl(link('minor'))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: false,
    });
    expect(fakeOutcomeFromUrl(link('minor_under13'))).toEqual({
      kind: 'minor',
      tier: 'declared',
      under13: true,
    });
    expect(fakeOutcomeFromUrl(link('unavailable'))).toEqual({ kind: 'unavailable' });
    expect(fakeOutcomeFromUrl(link('teen'))).toBeNull();
    expect(fakeOutcomeFromUrl(link('toString'))).toBeNull();
    expect(fakeOutcomeFromUrl(link(''))).toBeNull();
  });

  it('no link, no parameter or an unparseable link answers null', () => {
    expect(fakeOutcomeFromUrl(null)).toBeNull();
    expect(fakeOutcomeFromUrl(`${SCHEME}://welcome`)).toBeNull();
    expect(fakeOutcomeFromUrl(`${SCHEME}://welcome?other=adult`)).toBeNull();
    expect(fakeOutcomeFromUrl('not a url')).toBeNull();
    expect(fakeOutcomeFromUrl('')).toBeNull();
  });

  it('a development link with no fake value asks the store', async () => {
    constants.expoConfig = { extra: { variant: 'development' } };
    rn.Linking.getInitialURL.mockResolvedValue(`${SCHEME}://welcome`);
    const ageAssurance = await loadNative();
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({
      kind: 'minor',
      tier: 'confirmed',
      under13: false,
    });
    expect(lib.requestAgeRangeAsync).toHaveBeenCalledTimes(1);
  });

  it('production ignores the deep link', async () => {
    constants.expoConfig = { extra: { variant: 'production' } };
    const ageAssurance = await loadNative();
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({
      kind: 'minor',
      tier: 'confirmed',
      under13: false,
    });
    expect(lib.requestAgeRangeAsync).toHaveBeenCalledTimes(1);
    expect(rn.Linking.getInitialURL).not.toHaveBeenCalled();
  });

  it('staging and a build with no variant ignore the deep link', async () => {
    for (const expoConfig of [{ extra: { variant: 'staging' } }, { extra: {} }, {}, null]) {
      constants.expoConfig = expoConfig;
      const ageAssurance = await loadNative();
      await expect(ageAssurance.requestStoreSignal()).resolves.toMatchObject({ kind: 'minor' });
    }
    expect(rn.Linking.getInitialURL).not.toHaveBeenCalled();
  });

  it('the URL is read once', async () => {
    constants.expoConfig = { extra: { variant: 'development' } };
    const ageAssurance = await loadNative();
    await ageAssurance.requestStoreSignal();
    await ageAssurance.requestStoreSignal();
    expect(rn.Linking.getInitialURL).toHaveBeenCalledTimes(1);
  });

  it('a failed URL read asks the store', async () => {
    constants.expoConfig = { extra: { variant: 'development' } };
    rn.Linking.getInitialURL.mockRejectedValue(new Error('fixture failure'));
    const ageAssurance = await loadNative();
    await expect(ageAssurance.requestStoreSignal()).resolves.toMatchObject({ kind: 'minor' });
  });
});
