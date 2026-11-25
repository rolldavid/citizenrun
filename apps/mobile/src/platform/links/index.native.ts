import { parseSafeUrl, SOURCE_URL_MAX } from '@citizenrun/shared';
import { Linking, Platform } from 'react-native';
import { z } from 'zod';

import { getAppEnv } from '@/lib/env';

import { isIssuedUrlAllowed } from './issued-url';
import type { Links, OpenOutcome } from './types';

const EmailSchema = z.email();

async function openUrl(url: string): Promise<OpenOutcome> {
  try {
    await Linking.openURL(url);
    return 'opened';
  } catch {
    return 'failed';
  }
}

function storeUrl(): string | null {
  const env = getAppEnv();
  return Platform.OS === 'ios' ? env.appStoreUrl : env.playStoreUrl;
}

export const links: Links = {
  openExternal: async (url) => {
    const safe = parseSafeUrl(url, SOURCE_URL_MAX);
    if (safe === null) {
      return 'refused';
    }
    return openUrl(safe.url);
  },
  openIssuedUrl: async (url) => {
    if (!isIssuedUrlAllowed(url)) {
      return 'refused';
    }
    return openUrl(url);
  },
  openMail: async (address) => {
    if (!EmailSchema.safeParse(address).success) {
      return 'refused';
    }
    return openUrl('mailto:' + address);
  },
  openAppSettings: async () => {
    try {
      await Linking.openSettings();
      return true;
    } catch {
      return false;
    }
  },
  get storeListingSupported() {
    return storeUrl() !== null;
  },
  openStoreListing: async () => {
    const url = storeUrl();
    if (url === null) {
      return false;
    }
    return (await openUrl(url)) === 'opened';
  },
  reloadOnce: () => false,
  subscribeKeyDown: () => () => undefined,
  fontsReady: () => Promise.resolve(true), // the faces are in the binary
};

export type * from './types';
