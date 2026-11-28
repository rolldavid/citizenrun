import {
  getRequiredRegulatoryFeaturesAsync,
  isEligibleForAgeFeaturesAsync,
  requestAgeRangeAsync,
  requestAgeSignalsAccessAsync,
  showSignificantUpdateAcknowledgmentAsync,
} from 'expo-age-range';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { fakeOutcomeFromUrl } from './fake-signal';
import { mapAgeOutcome } from './map-outcome';
import type { AgeAssurance, AgeOutcome } from './types';

const UNAVAILABLE: AgeOutcome = { kind: 'unavailable' };
const ADULT_THRESHOLD = 18; // the single threshold (D-350)
const ACKNOWLEDGMENT_FEATURE = 'significantAppChangeRequiresAdultNotification';

let initialUrl: Promise<string | null> | null = null;

function isDevelopmentVariant(): boolean {
  const extra: unknown = Constants.expoConfig?.extra;
  if (typeof extra !== 'object' || extra === null || !Object.hasOwn(extra, 'variant')) {
    return false;
  }
  return Reflect.get(extra, 'variant') === 'development';
}

/** The deep link the process started with, read once per process. */
function readInitialUrl(): Promise<string | null> {
  initialUrl ??= Linking.getInitialURL().then(
    (url) => url ?? null,
    () => null,
  );
  return initialUrl;
}

/** The development fake signal (D-552, D-569). Staging and production never read the URL. */
async function fakeOutcome(): Promise<AgeOutcome | null> {
  if (!isDevelopmentVariant()) {
    return null;
  }
  return fakeOutcomeFromUrl(await readInitialUrl());
}

async function storeOutcome(): Promise<AgeOutcome> {
  if (Platform.OS === 'android') {
    const status = await requestAgeSignalsAccessAsync();
    if (status !== 'SHARED') {
      return UNAVAILABLE;
    }
  } else {
    const eligible = await isEligibleForAgeFeaturesAsync();
    if (eligible === false) {
      return UNAVAILABLE;
    }
  }
  return mapAgeOutcome(await requestAgeRangeAsync({ threshold1: ADULT_THRESHOLD }));
}

export const ageAssurance: AgeAssurance = {
  storeSignalSupported: true,
  requestStoreSignal: async () => {
    try {
      const fake = await fakeOutcome();
      if (fake !== null) {
        return fake;
      }
      return await storeOutcome();
    } catch {
      return UNAVAILABLE; // a declined prompt, an unavailable service or any library error
    }
  },
  significantUpdateAcknowledgmentRequired: async () => {
    if (Platform.OS !== 'ios') {
      return false;
    }
    try {
      const features = await getRequiredRegulatoryFeaturesAsync();
      return features?.includes(ACKNOWLEDGMENT_FEATURE) === true;
    } catch {
      return false;
    }
  },
  acknowledgeSignificantUpdate: async () => {
    if (Platform.OS !== 'ios') {
      return;
    }
    try {
      // The interface carries no description, and a module renders no text it chose itself.
      await showSignificantUpdateAcknowledgmentAsync('');
    } catch {
      // dropped (D-350)
    }
  },
};

export type * from './types';
