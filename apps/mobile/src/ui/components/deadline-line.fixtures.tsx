import type { ColorToken } from '@/ui/tokens';

import type { DeadlineLineProps } from './deadline-line';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  card: {
    variant: 'card',
    text: 'Filing closes Fri, Nov 27. Confirm with your election office.',
    testID: 'gallery.deadline-line-card',
  },
  // A source states the closing time.
  cardAt: {
    variant: 'card',
    text: 'Filing closes Fri, Nov 27 at 5:00 pm Pacific. Confirm with your election office.',
    testID: 'gallery.deadline-line-card-at',
  },
  cardUnknown: {
    variant: 'card',
    text: 'Filing deadline not known yet. Confirm with your election office.',
    testID: 'gallery.deadline-line-card-unknown',
  },
  row: { variant: 'row', text: 'closes Fri, Nov 27', testID: 'gallery.deadline-line-row' },
  rowAt: {
    variant: 'row',
    text: 'closes Fri, Nov 27 at 5:00 pm Pacific',
    testID: 'gallery.deadline-line-row-at',
  },
  // Seven days left or fewer: the flag, then the closing date.
  rowFlag: {
    variant: 'row',
    text: 'closes Fri, Nov 20',
    flagLabel: '5 days to file',
    testID: 'gallery.deadline-line-row-flag',
  },
  rowNone: {
    variant: 'row',
    text: 'no election scheduled yet',
    testID: 'gallery.deadline-line-row-none',
  },
} as const satisfies Readonly<Record<string, DeadlineLineProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
