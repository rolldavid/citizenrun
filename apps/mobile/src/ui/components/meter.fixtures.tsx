import type { ColorToken } from '@/ui/tokens';

import type { MeterProps } from './meter';
import type { InteractionPreviewState } from './pressable';

const press = (): void => undefined;

export const STATES = {
  feedKnown: {
    form: 'feed',
    name: 'Ease',
    score: 72,
    phrase: 'Easier than most',
    onPress: press,
    testID: 'gallery.meter-feed-known',
  },
  // A score nobody knows: ten outlines and "not known yet".
  unknown: {
    form: 'feed',
    name: 'Ease',
    score: null,
    phrase: null,
    onPress: press,
    testID: 'gallery.meter-unknown',
  },
  // Low confidence changes the phrase alone.
  about: {
    form: 'feed',
    name: 'Ease',
    score: 72,
    phrase: 'About: easier than most',
    onPress: press,
    testID: 'gallery.meter-about',
  },
  feedZero: {
    form: 'feed',
    name: 'Ease',
    score: 0,
    phrase: 'Harder than most',
    onPress: press,
    testID: 'gallery.meter-feed-zero',
  },
  feedFull: {
    form: 'feed',
    name: 'Ease',
    score: 100,
    phrase: 'Easier than most',
    onPress: press,
    testID: 'gallery.meter-feed-full',
  },
  pageKnown: {
    form: 'page',
    name: 'Impact',
    score: 45,
    phrase: 'Medium on Property taxes',
    onPress: press,
    testID: 'gallery.meter-page-known',
  },
  pageExpanded: {
    form: 'page',
    name: 'Impact',
    score: 45,
    phrase: 'Medium on Property taxes',
    expanded: true,
    onPress: press,
    testID: 'gallery.meter-page-expanded',
  },
  pageUnknown: {
    form: 'page',
    name: 'Impact',
    score: null,
    phrase: null,
    onPress: press,
    testID: 'gallery.meter-page-unknown',
  },
  // The lit pips cut on once, the first time the item is seen.
  withMotion: {
    form: 'feed',
    name: 'Ease',
    score: 72,
    phrase: 'Easier than most',
    onPress: press,
    itemKey: 'fixture-meter',
    testID: 'gallery.meter-with-motion',
  },
} as const satisfies Readonly<Record<string, MeterProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
