import type { ColorToken } from '@/ui/tokens';

import type { BigNumberProps } from './big-number';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  hero: {
    value: { text: '$52,900', about: false },
    label: 'a year',
    size: 'hero',
    accessibilityLabel: 'Pays $52,900 a year.',
    testID: 'gallery.big-number-hero',
  },
  // A figure too long for the narrowest measure arrives compact; the sentence still says it whole.
  display: {
    value: { text: '$84M', about: false },
    label: 'Budget, 2026',
    size: 'display',
    accessibilityLabel: 'The 2026 budget is $84,000,000.',
    testID: 'gallery.big-number-display',
  },
  title: {
    value: { text: '85', about: false },
    label: 'signatures',
    size: 'title',
    accessibilityLabel: '85 signatures.',
    testID: 'gallery.big-number-title',
  },
  heading: {
    value: { text: '12', about: false },
    label: 'days to file',
    size: 'heading',
    accessibilityLabel: '12 days to file.',
    testID: 'gallery.big-number-heading',
  },
  about: {
    value: { text: '2,100', about: true },
    label: 'votes to win',
    size: 'display',
    accessibilityLabel: 'About 2,100 votes to win.',
    testID: 'gallery.big-number-about',
  },
  unknown: {
    value: { text: null, about: false },
    label: 'votes to win',
    size: 'display',
    accessibilityLabel: 'Votes to win: not known yet.',
    testID: 'gallery.big-number-unknown',
  },
  // The figure rises once, the first time the item is seen.
  withMotion: {
    value: { text: '$52,900', about: false },
    label: 'a year',
    size: 'hero',
    itemKey: 'fixture-big-number',
    accessibilityLabel: 'Pays $52,900 a year.',
    testID: 'gallery.big-number-with-motion',
  },
} as const satisfies Readonly<Record<string, BigNumberProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
