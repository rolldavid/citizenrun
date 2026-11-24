import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { showToast } from './toast';

/** What `showToast` takes: a toast has no component of its own to take props. */
type ToastProps = Parameters<typeof showToast>[0];

export const STATES = {
  success: { kind: 'success', text: 'Link copied' },
  warning: { kind: 'warning', text: 'Saved on this phone. It will send when you are back online.' },
  error: { kind: 'error', text: "Couldn't follow this office. Try again." },
  // Two lines on a phone: the toast grows and its icon stays beside the text.
  longText: {
    kind: 'error',
    text: "Couldn't save your answer for Wren County Board of Equalization and Assessment Appeals, District 4. Try again.",
  },
} as const satisfies Readonly<Record<string, ToastProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
