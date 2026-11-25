import type { ColorToken } from '@/ui/tokens';

import type { NoticeProps } from './notice';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  info: { kind: 'info', text: 'Showing offices nationwide.' },
  warning: { kind: 'warning', text: 'Filing for this office closes in 3 days, on Fri, Nov 27.' },
  error: { kind: 'error', text: 'That photo could not be uploaded.' },
  infoWithAction: {
    kind: 'info',
    text: 'Showing offices nationwide.',
    action: {
      label: 'Set location',
      onPress: () => undefined,
      testID: 'gallery.notice-set-location',
    },
  },
  errorWithAction: {
    kind: 'error',
    text: 'That photo could not be uploaded.',
    action: { label: 'Try again', onPress: () => undefined, testID: 'gallery.notice-retry' },
  },
  // A pinned row: the pin in place of the kind's own icon.
  pinIcon: { kind: 'info', icon: 'pin', text: 'A deadline changed in Wren County.' },
  // Three sentences: the block grows and the icon stays on the first line.
  longText: {
    kind: 'warning',
    text: '2 of the offices you follow file on the same day. Wren County Clerk and Alder School Board, Seat 3, both close Fri, Mar 6. You can file for only one of them.',
  },
} as const satisfies Readonly<Record<string, NoticeProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
