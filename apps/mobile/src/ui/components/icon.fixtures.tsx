import type { ColorToken } from '@/ui/tokens';

import type { IconProps } from './icon';

/** The forced interaction state of a specimen, as the gallery reads it. */
type PreviewState = { pressed?: boolean; hovered?: boolean; focused?: boolean };

export const STATES = {
  // Every icon of the set, at the standard size in the primary tone.
  home: { name: 'home' },
  homeFilled: { name: 'homeFilled' },
  explore: { name: 'explore' },
  exploreFilled: { name: 'exploreFilled' },
  plus: { name: 'plus' },
  activity: { name: 'activity' },
  activityFilled: { name: 'activityFilled' },
  profile: { name: 'profile' },
  profileFilled: { name: 'profileFilled' },
  messages: { name: 'messages' },
  messagesFilled: { name: 'messagesFilled' },
  heart: { name: 'heart' },
  heartFilled: { name: 'heartFilled' },
  comment: { name: 'comment' },
  repost: { name: 'repost' },
  share: { name: 'share' },
  bookmark: { name: 'bookmark' },
  bookmarkFilled: { name: 'bookmarkFilled' },
  play: { name: 'play' },
  playFilled: { name: 'playFilled' },
  sound: { name: 'sound' },
  mute: { name: 'mute' },
  back: { name: 'back' },
  chevronRight: { name: 'chevronRight' },
  chevronDown: { name: 'chevronDown' },
  more: { name: 'more' },
  close: { name: 'close' },
  check: { name: 'check' },
  arrow: { name: 'arrow' },
  send: { name: 'send' },
  minus: { name: 'minus' },
  search: { name: 'search' },
  filter: { name: 'filter' },
  settings: { name: 'settings' },
  edit: { name: 'edit' },
  trash: { name: 'trash' },
  lock: { name: 'lock' },
  link: { name: 'link' },
  tag: { name: 'tag' },
  camera: { name: 'camera' },
  image: { name: 'image' },
  map: { name: 'map' },
  grid: { name: 'grid' },
  layers: { name: 'layers' },
  near: { name: 'near' },
  pin: { name: 'pin' },
  globe: { name: 'globe' },
  calendar: { name: 'calendar' },
  info: { name: 'info' },
  warning: { name: 'warning' },
  error: { name: 'error' },
  report: { name: 'report' },
  block: { name: 'block' },
  star: { name: 'star' },
  starFilled: { name: 'starFilled' },
  qr: { name: 'qr' },
  // The two smaller sizes, three tones and an icon with a name of its own.
  small: { name: 'heart', size: 'small' },
  medium: { name: 'heart', size: 'medium' },
  secondary: { name: 'info', tone: 'secondary' },
  danger: { name: 'error', tone: 'danger' },
  inverse: { name: 'check', tone: 'inverse' },
  labelled: { name: 'warning', label: 'Warning' },
} as const satisfies Readonly<Record<string, IconProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, PreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {
  inverse: 'inverseBg',
};
