import type { ReactElement } from 'react';

import type { ColorToken } from '@/ui/tokens';

import { AVATAR_PHOTO_FIXTURE } from './__fixtures__/avatar-photo';
import { FollowButton } from './follow-button';
import type { PersonRowProps } from './person-row';
import type { InteractionPreviewState } from './pressable';

/** The small button a row carries as its action. */
function follow(subject: string, testID: string): ReactElement {
  return (
    <FollowButton
      following={false}
      onToggle={() => undefined}
      size="sm"
      subject={subject}
      itemKey="fixture-person"
      testID={testID}
    />
  );
}

export const STATES = {
  holder: {
    image: AVATAR_PHOTO_FIXTURE,
    name: 'Carol Wynn',
    handle: null,
    line: 'Holder since 2019',
    tag: { label: 'Independent', variant: 'outline' },
    action: null,
    href: '/dev/gallery',
    testID: 'gallery.person-row-holder',
  },
  withAction: {
    image: null,
    name: 'Dana Okafor',
    handle: 'dana_okafor',
    line: 'Running for Fixture Alder City Council',
    tag: null,
    action: follow('Dana Okafor', 'gallery.person-row-with-action-follow'),
    href: '/dev/gallery',
    testID: 'gallery.person-row-with-action',
  },
  // With an action at the right, the tag moves in front of the line.
  tagAndAction: {
    image: AVATAR_PHOTO_FIXTURE,
    name: 'Luis Marrero',
    handle: 'luis_marrero',
    line: 'Filed Thu, Nov 12',
    tag: { label: 'Filed', variant: 'solid' },
    action: follow('Luis Marrero', 'gallery.person-row-tag-and-action-follow'),
    href: '/dev/gallery',
    testID: 'gallery.person-row-tag-and-action',
  },
  // No photo is the usual case: the initials.
  noPhoto: {
    image: null,
    name: 'Tasha Whitfield',
    handle: null,
    line: 'Says she is running',
    tag: { label: 'Not verified', variant: 'outline' },
    action: null,
    href: '/dev/gallery',
    testID: 'gallery.person-row-no-photo',
  },
  // A director known from a roster alone has no page to open.
  notALink: {
    image: null,
    name: 'Tasha Whitfield',
    handle: null,
    line: 'Director, Fixture Wren County Water Board',
    tag: null,
    action: null,
    href: null,
    testID: 'gallery.person-row-not-a-link',
  },
  handleOnly: {
    image: null,
    name: null,
    handle: 'dana_okafor',
    line: null,
    tag: null,
    action: null,
    href: '/dev/gallery',
    testID: 'gallery.person-row-handle-only',
  },
  longName: {
    image: null,
    name: 'Fixture Maria Guadalupe Hernandez Castellanos de la Fuente',
    handle: null,
    line: 'Holder since 2019',
    tag: { label: 'Independent', variant: 'outline' },
    action: null,
    href: '/dev/gallery',
    testID: 'gallery.person-row-long-name',
  },
} as const satisfies Readonly<Record<string, PersonRowProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
