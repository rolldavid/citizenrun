import type { ColorToken } from '@/ui/tokens';

import { FIXTURE_ALT_TEXT, FixtureRunAgainstCanvas } from './__fixtures__/fixture-canvas';
import { STATES as ACTION_ROW_STATES } from './action-row.fixtures';
import type { OfficeCardProps } from './office-card';
import type { InteractionPreviewState } from './pressable';

const press = (): void => undefined;

/** The office action row before Run exists, under the id of the card's own state. */
function actions(testID: string): OfficeCardProps['actions'] {
  return { ...ACTION_ROW_STATES.rowHidden, testID };
}

// Under a card the source row says the confidence in words when it has no host to show.
const LOW_SOURCE = { confidence: 'low', text: 'Low confidence · Sources', onPress: press } as const;

/** The County Treasurer of Fixture Wren County, ZZ, shown because it is in the viewer's county. */
const KNOWN = {
  header: {
    illustration: 'county-treasurer',
    reason: 'In your county',
    match: 'Matches Property taxes',
  },
  canvas: <FixtureRunAgainstCanvas variant="known" />,
  altText: FIXTURE_ALT_TEXT.known,
  href: '/office/fixture-county-treasurer',
  ease: null,
  impact: null,
  closingLine: 'Filing closes Fri, Nov 27. Confirm with your election office.',
  costLine: '$50 to file.',
  source: { confidence: 'medium', text: 'wrencounty.example. Checked Nov 9.', onPress: press },
  onOpenMenu: press,
  itemKey: 'fixture-office-1',
} as const;

export const STATES = {
  known: {
    ...KNOWN,
    actions: actions('gallery.office-card-known-actions'),
    testID: 'gallery.office-card-known',
  },
  // Nothing to act on is known: the canvas, the closing line and the source row all say so.
  unknown: {
    ...KNOWN,
    canvas: <FixtureRunAgainstCanvas variant="allUnknown" />,
    altText: FIXTURE_ALT_TEXT.allUnknown,
    closingLine: 'Filing deadline not known yet. Confirm with your election office.',
    costLine: null,
    source: LOW_SOURCE,
    actions: actions('gallery.office-card-unknown-actions'),
    testID: 'gallery.office-card-unknown',
  },
  // Low confidence: the canvas draws the estimate word on votes, and the source row says the rest.
  about: {
    ...KNOWN,
    source: LOW_SOURCE,
    actions: actions('gallery.office-card-about-actions'),
    testID: 'gallery.office-card-about',
  },
  noMatch: {
    ...KNOWN,
    header: { ...KNOWN.header, match: null },
    actions: actions('gallery.office-card-no-match-actions'),
    testID: 'gallery.office-card-no-match',
  },
  // A district whose shape is not exact.
  approximate: {
    ...KNOWN,
    header: { ...KNOWN.header, match: 'May include you. Check your district.' },
    actions: actions('gallery.office-card-approximate-actions'),
    testID: 'gallery.office-card-approximate',
  },
  following: {
    ...KNOWN,
    actions: {
      ...actions('gallery.office-card-following-actions'),
      following: true,
      bookmarked: true,
    },
    testID: 'gallery.office-card-following',
  },
  // Scores arrive later; the row is here for its geometry.
  withMeters: {
    ...KNOWN,
    ease: { name: 'Ease', score: 72, phrase: 'Easier than most', onPress: press },
    impact: { name: 'Impact', score: 45, phrase: 'Medium on Property taxes', onPress: press },
    actions: actions('gallery.office-card-with-meters-actions'),
    testID: 'gallery.office-card-with-meters',
  },
} as const satisfies Readonly<Record<string, OfficeCardProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
