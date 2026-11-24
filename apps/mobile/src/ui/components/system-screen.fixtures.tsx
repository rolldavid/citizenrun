import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { SystemScreenProps } from './system-screen';

export const STATES = {
  // The blocking update: one ink button and no way round it.
  blocking: {
    title: 'Update to keep going.',
    body: 'This version of the app is out of date.',
    action: {
      label: 'Update',
      variant: 'primary',
      onPress: () => undefined,
      testID: 'gallery.system-screen-update',
    },
    testID: 'gallery.system-screen-blocking',
  },
  noAction: {
    title: 'Back soon.',
    body: 'We are making a change. Try again in a few minutes.',
    testID: 'gallery.system-screen-no-action',
  },
  // A suspended account: the reason, an appeal and a quiet way out.
  withSecondary: {
    title: 'This account is suspended.',
    body: 'It broke the content policy.',
    action: {
      label: 'Appeal',
      variant: 'secondary',
      onPress: () => undefined,
      testID: 'gallery.system-screen-appeal',
    },
    secondaryAction: {
      label: 'Sign out',
      onPress: () => undefined,
      testID: 'gallery.system-screen-sign-out',
    },
    testID: 'gallery.system-screen-with-secondary',
  },
  longText: {
    title: 'Something went wrong, and reloading did not fix it.',
    body: 'Try again. If it keeps happening, update the app, then open it again. Nothing you saved is lost: your bookmarks and the offices you follow are kept with your account.',
    action: {
      label: 'Try again',
      variant: 'primary',
      onPress: () => undefined,
      testID: 'gallery.system-screen-retry',
    },
    testID: 'gallery.system-screen-long-text',
  },
} as const satisfies Readonly<Record<string, SystemScreenProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
