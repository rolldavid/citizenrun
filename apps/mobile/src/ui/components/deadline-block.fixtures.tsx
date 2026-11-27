import type { ColorToken } from '@/ui/tokens';

import type { DeadlineBlockProps } from './deadline-block';
import type { InteractionPreviewState } from './pressable';
import type { SourceLinkProps } from './source-link';

const press = (): void => undefined;

const CAUTION = 'Confirm with your election office.';

/** The source row of a state, under an id derived from the block's own. */
function sourceOf(testID: string): SourceLinkProps {
  return {
    confidence: 'medium',
    text: 'wrencounty.example. Checked Mon, Nov 9.',
    onPress: press,
    testID: `${testID}-source`,
  };
}

export const STATES = {
  open: {
    state: 'open',
    daysLeft: 12,
    headline: '12 days left to file',
    flagLabel: null,
    lines: ['Closes Fri, Nov 27, 2026 at 5:00 pm Pacific.', 'File in person at the county clerk.'],
    source: sourceOf('gallery.deadline-block-open'),
    caution: CAUTION,
    testID: 'gallery.deadline-block-open',
  },
  // Seven days left or fewer: the headline is a flag, and the closing date follows it.
  openSoon: {
    state: 'open',
    daysLeft: 5,
    headline: '5 days left to file',
    flagLabel: '5 days to file',
    lines: ['Closes Fri, Nov 20, 2026 at 5:00 pm Pacific.', 'File in person at the county clerk.'],
    source: sourceOf('gallery.deadline-block-open-soon'),
    caution: CAUTION,
    testID: 'gallery.deadline-block-open-soon',
  },
  notOpen: {
    state: 'not_open',
    daysLeft: null,
    headline: 'Filing opens in 9 days',
    flagLabel: null,
    lines: ['Opens Mon, Nov 23, 2026.'],
    source: sourceOf('gallery.deadline-block-not-open'),
    caution: CAUTION,
    testID: 'gallery.deadline-block-not-open',
  },
  closed: {
    state: 'closed',
    daysLeft: null,
    headline: 'Filing closed',
    flagLabel: null,
    lines: ['Closed Fri, Nov 6, 2026.'],
    source: sourceOf('gallery.deadline-block-closed'),
    caution: CAUTION,
    testID: 'gallery.deadline-block-closed',
  },
  unknown: {
    state: 'unknown',
    daysLeft: null,
    headline: 'Filing deadline not known yet',
    flagLabel: null,
    lines: [],
    source: null,
    caution: CAUTION,
    testID: 'gallery.deadline-block-unknown',
  },
  // Two sources disagree: both dates are named and the earlier one is shown.
  conflict: {
    state: 'open',
    daysLeft: 12,
    headline: '12 days left to file',
    flagLabel: null,
    lines: ['Closes Fri, Nov 27, 2026 at 5:00 pm Pacific.', 'File in person at the county clerk.'],
    source: sourceOf('gallery.deadline-block-conflict'),
    caution: CAUTION,
    conflict:
      'Two closing dates are listed: Fri, Nov 27 and Mon, Nov 30. The earlier one is shown.',
    testID: 'gallery.deadline-block-conflict',
  },
  // The ticks cut on and the flag dips once, the first time the item is seen.
  withMotion: {
    state: 'open',
    daysLeft: 5,
    headline: '5 days left to file',
    flagLabel: '5 days to file',
    lines: ['Closes Fri, Nov 20, 2026 at 5:00 pm Pacific.', 'File in person at the county clerk.'],
    source: sourceOf('gallery.deadline-block-with-motion'),
    caution: CAUTION,
    itemKey: 'fixture-deadline-block',
    testID: 'gallery.deadline-block-with-motion',
  },
} as const satisfies Readonly<Record<string, DeadlineBlockProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
