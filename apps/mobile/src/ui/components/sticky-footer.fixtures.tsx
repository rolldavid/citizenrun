import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import type { StickyFooterProps } from './sticky-footer';

const press = (): void => undefined;

export const STATES = {
  primaryOnly: {
    primary: {
      label: 'Continue',
      onPress: press,
      testID: 'gallery.sticky-footer-primary-only-continue',
    },
  },
  // A disabled primary says why in its label.
  primaryDisabled: {
    primary: {
      label: 'Pick 3 or more',
      disabled: true,
      onPress: press,
      testID: 'gallery.sticky-footer-primary-disabled-continue',
    },
  },
  primaryBusy: {
    primary: {
      label: 'Continue',
      busy: true,
      onPress: press,
      testID: 'gallery.sticky-footer-primary-busy-continue',
    },
  },
  withSecondary: {
    secondary: {
      label: 'Skip',
      variant: 'quiet',
      onPress: press,
      testID: 'gallery.sticky-footer-with-secondary-skip',
    },
    primary: {
      label: 'Continue',
      onPress: press,
      testID: 'gallery.sticky-footer-with-secondary-continue',
    },
  },
  // The count picked stands at the left, and the helper under it leaves on a tight layout.
  withInfo: {
    info: { line: '5 picked, 2 starred', helper: 'You can change these later.' },
    primary: {
      label: 'Continue',
      onPress: press,
      testID: 'gallery.sticky-footer-with-info-continue',
    },
  },
  // No primary: each change is applied at once, and the one button stands at the right.
  secondaryOnly: {
    secondary: {
      label: 'Clear filters',
      variant: 'secondary',
      onPress: press,
      testID: 'gallery.sticky-footer-secondary-only-clear',
    },
  },
} as const satisfies Readonly<Record<string, StickyFooterProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
