import type { ColorToken } from '@/ui/tokens';

import { AVATAR_PHOTO_FIXTURE } from './__fixtures__/avatar-photo';
import { FollowButton } from './follow-button';
import type { InteractionPreviewState } from './pressable';
import type { ProfileHeaderProps } from './profile-header';
import { Tag } from './tag';

/** An officeholder from public records: no handle, no bio, nothing to press. */
const PERSON = {
  image: null,
  name: 'Carol Wynn',
  handle: null,
  tag: null,
  lines: ['County Treasurer · Fixture Wren County, ZZ'],
  bio: null,
  link: null,
  photoCredit: null,
  stats: [],
  actions: [],
  notice: null,
} as const;

export const STATES = {
  person: { ...PERSON, testID: 'gallery.profile-header-person' },
  personWithPhoto: {
    ...PERSON,
    image: AVATAR_PHOTO_FIXTURE,
    photoCredit: 'Fixture Photographer, CC BY 4.0, cropped',
    testID: 'gallery.profile-header-person-with-photo',
  },
  // A candidate nobody has claimed: the initials, and where the page came from.
  unclaimed: {
    ...PERSON,
    name: 'Luis Marrero',
    tag: <Tag label="Filed" variant="outline" />,
    lines: [
      'Running for County Treasurer · Fixture Wren County, ZZ',
      'Created from public filings',
    ],
    testID: 'gallery.profile-header-unclaimed',
  },
  withTag: {
    ...PERSON,
    tag: <Tag label="Independent" variant="outline" />,
    testID: 'gallery.profile-header-with-tag',
  },
  longName: {
    ...PERSON,
    name: 'Fixture Maria Guadalupe Hernandez Castellanos de la Fuente',
    tag: <Tag label="Independent" variant="outline" />,
    testID: 'gallery.profile-header-long-name',
  },
  // An account: the handle, a bio, a link and one action.
  withActions: {
    ...PERSON,
    name: 'Dana Okafor',
    handle: 'dana_okafor',
    lines: ['Running for Fixture Alder City Council'],
    bio: 'Bus rider and renter. Running so the council meets when working people can come.',
    link: { href: 'https://okafor.example/', domain: 'okafor.example' },
    actions: [
      <FollowButton
        key="follow"
        following={false}
        onToggle={() => undefined}
        subject="Dana Okafor"
        itemKey="fixture-person"
        testID="gallery.profile-header-with-actions-follow"
      />,
    ],
    testID: 'gallery.profile-header-with-actions',
  },
  // The sentence stands in for the lines, the bio and the link.
  blocked: {
    ...PERSON,
    name: 'Dana Okafor',
    handle: 'dana_okafor',
    lines: ['Running for Fixture Alder City Council'],
    bio: 'Bus rider and renter. Running so the council meets when working people can come.',
    link: { href: 'https://okafor.example/', domain: 'okafor.example' },
    notice: 'You blocked this account.',
    testID: 'gallery.profile-header-blocked',
  },
} as const satisfies Readonly<Record<string, ProfileHeaderProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
