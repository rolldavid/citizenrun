import { publicPageUrl } from '@/lib/navigation';
import { links } from '@/platform/links';
import { session } from '@/platform/session';

import type { SettingsAboutViewModel } from './settings-about.types';

const NO_SOURCES: SettingsAboutViewModel['sources'] = [];

function onOpen(url: string): void {
  void links.openExternal(url);
}

/** SCR-settings-about: no request. */
export function useSettingsAboutViewModel(): SettingsAboutViewModel {
  return {
    appVersion: session.client.appVersion,
    sources: NO_SOURCES,
    links: [
      { id: 'privacy', url: publicPageUrl('/privacy') },
      { id: 'terms', url: publicPageUrl('/terms') },
      { id: 'contentPolicy', url: publicPageUrl('/content-policy') },
    ],
    onOpen,
  };
}
