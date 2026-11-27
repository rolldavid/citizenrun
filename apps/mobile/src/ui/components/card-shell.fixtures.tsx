import type { JSX } from 'react';

import type { ColorToken } from '@/ui/tokens';

import { FIXTURE_ALT_TEXT, FixtureRunAgainstCanvas } from './__fixtures__/fixture-canvas';
import { ActionRow } from './action-row';
import { STATES as ACTION_ROW_STATES } from './action-row.fixtures';
import type { CardShellProps } from './card-shell';
import { OfficeTile } from './office-tile';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

const OFFICE_PAGE = '/office/fixture-county-treasurer';

/** The action row under the box, before Run exists; each state names its own, so no id repeats on a page. */
function actions(testID: string): JSX.Element {
  return <ActionRow {...ACTION_ROW_STATES.rowHidden} testID={testID} />;
}

const HEADER = {
  leading: <OfficeTile illustration="county-treasurer" size="md" />,
  title: 'In your county',
  subtitle: (
    <Text role="caption" tone="secondary" numberOfLines={1}>
      Matches Property taxes
    </Text>
  ),
  onOpenMenu: null,
} as const;

const BOX = {
  kind: 'canvas',
  canvas: <FixtureRunAgainstCanvas variant="known" />,
  altText: FIXTURE_ALT_TEXT.known,
} as const;

const META = (
  <>
    <Text role="label">Filing closes Fri, Nov 27. Confirm with your election office.</Text>
    <Text role="caption">$50 to file.</Text>
  </>
);

export const STATES = {
  // A generated card: the reason it is shown, the 4:5 box as a link, the action row, two meta lines.
  canvas: {
    header: HEADER,
    box: BOX,
    href: OFFICE_PAGE,
    actions: actions('gallery.card-shell-canvas-actions'),
    meta: META,
    testID: 'gallery.card-shell-canvas',
  },
  withMenu: {
    header: { ...HEADER, onOpenMenu: () => undefined },
    box: BOX,
    href: OFFICE_PAGE,
    actions: actions('gallery.card-shell-with-menu-actions'),
    meta: META,
    testID: 'gallery.card-shell-with-menu',
  },
  // Nothing to open: the box is a picture with its alt text.
  noHref: {
    header: HEADER,
    box: BOX,
    actions: actions('gallery.card-shell-no-href-actions'),
    meta: META,
    testID: 'gallery.card-shell-no-href',
  },
  titleLink: {
    header: { ...HEADER, titleHref: OFFICE_PAGE },
    box: BOX,
    href: OFFICE_PAGE,
    actions: actions('gallery.card-shell-title-link-actions'),
    meta: META,
    testID: 'gallery.card-shell-title-link',
  },
  // A reason longer than its line is cut on one line.
  longReason: {
    header: {
      ...HEADER,
      title: 'In your county and in the districts you follow around Fixture Alder',
    },
    box: BOX,
    href: OFFICE_PAGE,
    actions: actions('gallery.card-shell-long-reason-actions'),
    meta: META,
    testID: 'gallery.card-shell-long-reason',
  },
  noActions: {
    header: HEADER,
    box: BOX,
    href: OFFICE_PAGE,
    actions: null,
    meta: META,
    testID: 'gallery.card-shell-no-actions',
  },
  loading: {
    header: HEADER,
    box: BOX,
    href: OFFICE_PAGE,
    actions: actions('gallery.card-shell-loading-actions'),
    meta: META,
    loading: true,
    testID: 'gallery.card-shell-loading',
  },
} as const satisfies Readonly<Record<string, CardShellProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
