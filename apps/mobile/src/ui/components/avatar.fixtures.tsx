import type { ColorToken } from '@/ui/tokens';

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
} as const satisfies Readonly<Record<string, AvatarProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
