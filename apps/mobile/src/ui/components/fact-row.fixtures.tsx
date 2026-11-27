import type { ColorToken } from '@/ui/tokens';

import type { FactRowProps } from './fact-row';
import type { InteractionPreviewState } from './pressable';

const press = (): void => undefined;

export const STATES = {
  known: {
    label: 'Term',
    value: { text: '4 years', about: false },
    testID: 'gallery.fact-row-known',
  },
  about: {
    label: 'Pay per hour',
    value: { text: '$37.50', about: true },
    testID: 'gallery.fact-row-about',
  },
  unknown: {
    label: 'Hours',
    value: { text: null, about: false },
    testID: 'gallery.fact-row-unknown',
  },
  // The whole row opens the value's source.
  pressable: {
    label: 'Term',
    value: { text: '4 years', about: false },
    onPress: press,
    testID: 'gallery.fact-row-pressable',
  },
  pressableUnknown: {
    label: 'Hours',
    value: { text: null, about: false },
    onPress: press,
    testID: 'gallery.fact-row-pressable-unknown',
  },
  longValue: {
    label: 'Fits around a job',
    value: { text: 'Likely, with evening meetings', about: false },
    testID: 'gallery.fact-row-long-value',
  },
} as const satisfies Readonly<Record<string, FactRowProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
