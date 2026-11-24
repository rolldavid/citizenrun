import { ActivityIcon } from './activity';
import { ActivityFilledIcon } from './activity-filled';
import { ArrowIcon } from './arrow';
import { BackIcon } from './back';
import { BlockIcon } from './block';
import { BookmarkIcon } from './bookmark';
import { BookmarkFilledIcon } from './bookmark-filled';
import { CalendarIcon } from './calendar';
import { CameraIcon } from './camera';
import { CheckIcon } from './check';
import { ChevronDownIcon } from './chevron-down';
import { ChevronRightIcon } from './chevron-right';
import { CloseIcon } from './close';
import { CommentIcon } from './comment';
import type { IconComponent } from './draw';
import { EditIcon } from './edit';
import { ErrorIcon } from './error';
import { ExploreIcon } from './explore';
import { ExploreFilledIcon } from './explore-filled';
import { FilterIcon } from './filter';
import { GlobeIcon } from './globe';
import { GridIcon } from './grid';
import { HeartIcon } from './heart';
import { HeartFilledIcon } from './heart-filled';
import { HomeIcon } from './home';
import { HomeFilledIcon } from './home-filled';
import { ImageIcon } from './image';
import { InfoIcon } from './info';
import { LayersIcon } from './layers';
import { LinkIcon } from './link';
import { LockIcon } from './lock';
import { MapIcon } from './map';
import { MessagesIcon } from './messages';
import { MessagesFilledIcon } from './messages-filled';
import { MinusIcon } from './minus';
import { MoreIcon } from './more';
import { MuteIcon } from './mute';
import { NearIcon } from './near';
import { PinIcon } from './pin';
import { PlayIcon } from './play';
import { PlayFilledIcon } from './play-filled';
import { PlusIcon } from './plus';
import { ProfileIcon } from './profile';
import { ProfileFilledIcon } from './profile-filled';
import { QrIcon } from './qr';
import { ReportIcon } from './report';
import { RepostIcon } from './repost';
import { SearchIcon } from './search';
import { SendIcon } from './send';
import { SettingsIcon } from './settings';
import { ShareIcon } from './share';
import { SoundIcon } from './sound';
import { StarIcon } from './star';
import { StarFilledIcon } from './star-filled';
import { TagIcon } from './tag';
import { TrashIcon } from './trash';
import { WarningIcon } from './warning';

/** The interface icons of C-Icon, in the order of its set: every icon is project-owned SVG (D-160). */
export const ICONS = {
  // Tab bar and rail
  home: HomeIcon,
  homeFilled: HomeFilledIcon,
  explore: ExploreIcon,
  exploreFilled: ExploreFilledIcon,
  plus: PlusIcon,
  activity: ActivityIcon,
  activityFilled: ActivityFilledIcon,
  profile: ProfileIcon,
  profileFilled: ProfileFilledIcon,
  messages: MessagesIcon,
  messagesFilled: MessagesFilledIcon,
  // Post actions and video
  heart: HeartIcon,
  heartFilled: HeartFilledIcon,
  comment: CommentIcon,
  repost: RepostIcon,
  share: ShareIcon,
  bookmark: BookmarkIcon,
  bookmarkFilled: BookmarkFilledIcon,
  play: PlayIcon,
  playFilled: PlayFilledIcon,
  sound: SoundIcon,
  mute: MuteIcon,
  // Navigation and controls
  back: BackIcon,
  chevronRight: ChevronRightIcon,
  chevronDown: ChevronDownIcon,
  more: MoreIcon,
  close: CloseIcon,
  check: CheckIcon,
  arrow: ArrowIcon,
  send: SendIcon,
  minus: MinusIcon,
  search: SearchIcon,
  filter: FilterIcon,
  settings: SettingsIcon,
  edit: EditIcon,
  trash: TrashIcon,
  lock: LockIcon,
  link: LinkIcon,
  tag: TagIcon,
  camera: CameraIcon,
  image: ImageIcon,
  // Map and places
  map: MapIcon,
  grid: GridIcon,
  layers: LayersIcon,
  near: NearIcon,
  pin: PinIcon,
  globe: GlobeIcon,
  calendar: CalendarIcon,
  // Status and safety
  info: InfoIcon,
  warning: WarningIcon,
  error: ErrorIcon,
  report: ReportIcon,
  block: BlockIcon,
  star: StarIcon,
  starFilled: StarFilledIcon,
  qr: QrIcon,
} as const satisfies Readonly<Record<string, IconComponent>>;

export type IconName = keyof typeof ICONS;

/** The icon names in the order of C-Icon's set, for the gallery. */
export const ICON_NAMES: readonly IconName[] = Object.keys(ICONS) as IconName[]; // Object.keys loses the key type

export type { IconComponent, IconGlyphProps } from './draw';
