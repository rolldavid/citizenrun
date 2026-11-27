import type { ColorToken } from '@/ui/tokens';

import type { DealLineProps } from './deal-line';
import type { InteractionPreviewState } from './pressable';

const press = (): void => undefined;

export const STATES = {
  payHours: {
    parts: [
      { id: 'pay', text: 'Pays $52,900 a year.', figure: '$52,900', onPress: press },
      { id: 'hours', text: 'About 20 hours a week.', figure: '20 hours', onPress: press },
    ],
    testID: 'gallery.deal-line-pay-hours',
  },
  payOnly: {
    parts: [{ id: 'pay', text: 'Pays $52,900 a year.', figure: '$52,900', onPress: press }],
    testID: 'gallery.deal-line-pay-only',
  },
  // A part whose value nobody knows is plain text: it opens nothing.
  unknown: {
    parts: [
      { id: 'pay', text: 'Pay not known yet.' },
      { id: 'hours', text: 'Hours not known yet.' },
    ],
    testID: 'gallery.deal-line-unknown',
  },
  about: {
    parts: [{ id: 'pay', text: 'Pays about $52,900 a year.', figure: '$52,900', onPress: press }],
    testID: 'gallery.deal-line-about',
  },
  // Four sentences: five lines on the smallest phone.
  long: {
    parts: [
      {
        id: 'pay',
        text: 'Pays $52,941 a year plus benefits.',
        figure: '$52,941',
        onPress: press,
      },
      { id: 'hours', text: 'About 20 hours a week.', figure: '20 hours', onPress: press },
      { id: 'impact', text: 'High impact on Rent and housing costs.' },
      { id: 'votes', text: 'About 2,100 votes win it.', figure: '2,100 votes', onPress: press },
    ],
    testID: 'gallery.deal-line-long',
  },
} as const satisfies Readonly<Record<string, DealLineProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
