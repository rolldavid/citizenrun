import type { ColorToken } from '@/ui/tokens';

import { AVATAR_PHOTO_FIXTURE } from './__fixtures__/avatar-photo';
import type { AvatarProps } from './avatar';
import type { InteractionPreviewState } from './pressable';

export const STATES = {
  xs: { size: 'xs', image: null, name: 'Carol Wynn', handle: 'carol_wynn' },
  sm: { size: 'sm', image: null, name: 'Carol Wynn', handle: 'carol_wynn' },
  md: { size: 'md', image: null, name: 'Carol Wynn', handle: 'carol_wynn' },
  lg: { size: 'lg', image: null, name: 'Carol Wynn', handle: 'carol_wynn' },
  xl: { size: 'xl', image: null, name: 'Carol Wynn', handle: 'carol_wynn' },
  oneWord: { size: 'lg', image: null, name: 'Alder', handle: null },
  handleOnly: { size: 'lg', image: null, name: null, handle: 'dana_okafor' },
  empty: { size: 'lg', image: null, name: null, handle: null },
  // The flat disc a photo sits on until it is drawn.
  withImagePending: {
    size: 'lg',
    image: { key: 'fixture-avatar', url: 'https://media.example.test/fixture-avatar.jpg' },
    name: 'Carol Wynn',
    handle: 'carol_wynn',
  },
  decorative: {
    size: 'lg',
    image: null,
    name: 'Carol Wynn',
    handle: 'carol_wynn',
    decorative: true,
  },
  // A name the bundled face cannot draw whole.
  notDrawable: { size: 'lg', image: null, name: 'Nguyễn An', handle: null },
  // A photo at each size: it fades in over the flat disc.
  photoXs: { size: 'xs', image: AVATAR_PHOTO_FIXTURE, name: 'Carol Wynn', handle: 'carol_wynn' },
  photoSm: { size: 'sm', image: AVATAR_PHOTO_FIXTURE, name: 'Carol Wynn', handle: 'carol_wynn' },
  photoMd: { size: 'md', image: AVATAR_PHOTO_FIXTURE, name: 'Carol Wynn', handle: 'carol_wynn' },
  photoLg: { size: 'lg', image: AVATAR_PHOTO_FIXTURE, name: 'Carol Wynn', handle: 'carol_wynn' },
  photoXl: { size: 'xl', image: AVATAR_PHOTO_FIXTURE, name: 'Carol Wynn', handle: 'carol_wynn' },
  // A photo that never loads: the disc stays.
  photoMissing: {
    size: 'lg',
    image: {
      key: 'fixture-avatar-missing',
      url: 'https://example.test/fixture-avatar-missing.jpg',
    },
    name: 'Dana Okafor',
    handle: 'dana_okafor',
  },
} as const satisfies Readonly<Record<string, AvatarProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
