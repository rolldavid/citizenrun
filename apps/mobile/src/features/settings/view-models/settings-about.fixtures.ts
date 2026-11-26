import { noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsAboutViewModel } from './settings-about.types';

export const aboutM1 = {
  appVersion: '1.0.0',
  sources: [],
  links: [
    { id: 'privacy', url: 'https://example.test/privacy' },
    { id: 'terms', url: 'https://example.test/terms' },
    { id: 'contentPolicy', url: 'https://example.test/content-policy' },
  ],
  onOpen: noop,
} satisfies SettingsAboutViewModel;
