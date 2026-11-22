// Design tokens: the single source of every visual value.
// Lint rule citizenrun/tokens-only is off in this file.

/** The two fixed values, ink and bone. */
export const INK = '#141412';
export const BONE = '#F3F1EA';

export type ThemeName = 'light' | 'dark';

/** Core color tokens. */
const CORE = {
  light: {
    bg: '#F1EFE7', // page ground, bars, rails, map land
    surface: '#FDFCF9', // canvases, sheets, dialogs, inputs, panels, incoming message bubbles
    well: '#E3E0D5', // skeleton blocks, letterbox, hover and pressed fills, disabled fills, notices, map water
    text: INK, // primary text, filled icons, lit pips and ticks
    textSecondary: '#535148', // the only gray: context lines, sources, captions, unlit outlines, disabled labels
    rule: INK, // 1 px structural rules and control outlines
    ruleSoft: '#D5D2C7', // row dividers, the media keyline, map roads; never the only boundary
    accent: '#F04E14', // the Run button, and the spot in a drawing; nothing else
    accentHover: '#E84603', // Run under a mouse pointer
    onAccent: INK, // the label on Run
    highlight: '#D9F23E', // volt: the fill of a flag or a sticker, always under ink words
    onHighlight: INK, // text on volt and the 1 px keyline around every volt block
    success: '#17683A', // success text and icon; the border of a valid field
    danger: '#B3202A', // error text and icon; invalid field border; destructive button outline and label
    inverseBg: INK, // selected and done states, ink buttons, toasts, office tiles, own message bubbles
    inverseText: BONE,
    inverseTextSecondary: '#A9A69B',
    inverseHover: '#2A2A26', // an ink button under a mouse pointer
    posterBg: INK, // the ground of a poster canvas
    posterText: BONE,
    posterTextSecondary: '#A9A69B',
    scrim: 'rgba(20,20,18,0.48)', // the flat layer behind sheets and dialogs
    mediaControlBg: 'rgba(20,20,18,0.80)', // page counter and mute control: the only things ever drawn over media
    onMediaControl: BONE,
    mapNoData: '#FDFCF9', // fill of a district with no data; always outlined with mapNoDataLine
    mapPark: '#EAE7DE', // parks, from zoom 11
  },
  dark: {
    bg: '#121210',
    surface: '#1F1F1C',
    well: '#2A2A26',
    text: BONE,
    textSecondary: '#A9A69B',
    rule: '#A9A69B', // one step under text: light hairlines on dark look heavier
    ruleSoft: '#33332E',
    accent: '#F04E14',
    accentHover: '#FA5824',
    onAccent: INK,
    highlight: '#D9F23E',
    onHighlight: INK,
    success: '#6FD08C',
    danger: '#FD8692',
    inverseBg: BONE,
    inverseText: INK,
    inverseTextSecondary: '#535148',
    inverseHover: '#E3E0D5',
    posterBg: '#1F1F1C', // in the dark theme a poster sits on the same ground as every other canvas
    posterText: BONE,
    posterTextSecondary: '#A9A69B',
    scrim: 'rgba(0,0,0,0.60)',
    mediaControlBg: 'rgba(20,20,18,0.80)',
    onMediaControl: BONE,
    mapNoData: '#121210',
    mapPark: '#1E1E1B',
  },
} as const;

export type CoreColorToken = keyof (typeof CORE)['light'];

/** Aliases: one value, a second name for the role. Components use the role name. */
const ALIASES = {
  hoverBg: 'well',
  pressedBg: 'well',
  disabledBg: 'well',
  disabledText: 'textSecondary',
  skeleton: 'well',
  selectedBg: 'inverseBg',
  selectedText: 'inverseText',
  focusRing: 'text',
  noticeBg: 'well',
  noticeText: 'text',
  linkText: 'text',
  posterRule: 'posterText',
  mapLand: 'bg',
  mapMask: 'bg',
  mapWater: 'well',
  mapRoad: 'ruleSoft',
  mapNoDataLine: 'textSecondary',
  mapLabel: 'text',
  mapLabelSecondary: 'textSecondary',
  mapLabelHalo: 'bg',
  mapDistrictLine: 'bg',
  mapLevelLine: 'text',
  mapSelection: 'text',
  mapLineCasing: 'bg',
  mapYou: 'text',
  pinBg: 'text',
  pinGlyph: 'bg',
  pinKeyline: 'bg',
  bubbleBg: 'bg',
  bubbleText: 'text',
  bubbleKeyline: 'text',
  mapPulse: 'text',
} as const satisfies Record<string, CoreColorToken>;

export type AliasColorToken = keyof typeof ALIASES;
export type ColorToken = CoreColorToken | AliasColorToken;
export type ThemeColors = Readonly<Record<ColorToken, string>>;

function resolveTheme(name: ThemeName): ThemeColors {
  const core = CORE[name];
  const out: Record<string, string> = { ...core };
  for (const [alias, target] of Object.entries(ALIASES)) out[alias] = core[target];
  return out as ThemeColors; // every key of ColorToken was written by the two loops above
}

/** Every color token, resolved, for each theme. */
export const color: Readonly<Record<ThemeName, ThemeColors>> = {
  light: resolveTheme('light'),
  dark: resolveTheme('dark'),
};

/** The alias table, for the generated CSS and the token test. */
export const colorAliases: Readonly<Record<AliasColorToken, CoreColorToken>> = ALIASES;

/** Colors that do not change with the theme and belong to no theme key. */
export const fixed = {
  ink: INK,
  bone: BONE,
  doubleTapHeartFill: BONE, // the heart stamped on media by a double tap
  doubleTapHeartKeyline: INK,
  cropFrame: BONE, // the 1 px crop frame in the cropper
  notificationTint: '#7C7A72', // the Android notification icon tint
  emailBg: '#FFFFFF', // the ground of an email: ink on white (D-525)
  appIconField: INK,
  appIconLetters: BONE,
  deviceCalendar: INK, // the app-owned calendar on Android (PM-calendar); equals color.light.inverseBg
} as const;

/** Named opacities. Nothing else in the product is drawn at partial strength. */
export const opacity = {
  mapDim: 0.4, // districts other than the selected one
  skeletonLow: 0.55, // the low point of the loading pulse
  pulseLow: 0.25, // the low point of the map deadline pulse
  scrimLight: 0.48, // inside color.light.scrim
  scrimDark: 0.6, // inside color.dark.scrim
  mediaControl: 0.8, // inside mediaControlBg
} as const;

export const radius = {
  none: 0, // canvases, photos, video, sheets, dialogs, panels, bars, rails, meters, pips, skeleton blocks, flags
  tag: 2, // tags, the checkbox, the switch thumb, the media counter and mute control
  control: 4, // buttons, inputs, chips, segmented control, switch track, office tiles, toasts, notices, bubbles, share cards
  full: 9999, // avatars, pins, count bubbles, unread badges, the radio button
} as const;

/** Rule and outline widths, in points. */
export const rule = {
  hairline: 1, // every rule and outline
  tab: 2, // the underline of the active tab
  focus: 2, // the focus ring
  focusGap: 2, // the gap between a control and its focus ring
  active: 4, // the bar beside the active rail item; the height of a sheet grabber
  dottedSquare: 2, // the feed rule: 2 pt squares
  dottedPitch: 6, // the feed rule: on a 6 pt pitch
  panel: 2, // the rule down the left edge of a meter's inputs panel
  fieldState: 2, // the border of an invalid or a valid field
  heartKeyline: 3, // the keyline of the double-tap heart
  underline: 1, // a link or an opening figure in running text
  underlineHover: 2, // the same under a pointer or keyboard focus
} as const;

/** The 4-point grid plus the one 2-point gap between pips and ticks. */
export const space = {
  pip: 2,
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x6: 24,
  x8: 32,
  x12: 48,
} as const;

export const gutter = {
  regular: 24, // phones 380 points wide or more, and every wider layout outside the feed column
  narrow: 16, // under 380 points
  narrowBelow: 380,
  feedColumnWide: 0, // inside the feed column at medium and expanded
} as const;

/** Fixed sizes, in points. A height here is a minimum: text scaling may grow it. */
export const size = {
  target: 44,
  appBar: 48,
  tabBar: 56, // plus the bottom safe-area inset
  getAppBar: 44,
  cardHeaderMin: 52,
  actionRow: 60,
  listRowMin: 56,
  listRowCompact: 44, // menu rows, address suggestions, table rows, tagged-office rows
  button: 44,
  buttonSmall: 36,
  input: 48,
  chip: 44,
  chipSmall: 32,
  segmented: 36,
  railItem: 44,
  avatar: { xs: 28, sm: 36, md: 48, lg: 56, xl: 80 },
  avatarStackOverlap: 12,
  officeTile: { sm: 28, md: 36, lg: 48 },
  officeGlyph: { sm: 17, md: 22, lg: 29 }, // 60% of the tile, rounded
  issueTile: 28,
  icon: { small: 16, medium: 20, standard: 24 },
  iconStroke: 2,
  postTabBlock: { width: 44, height: 36 }, // the Post item in the tab bar
  badge: 16, // an unread count on an icon's corner
  badgeRow: 20, // an unread count at the right end of an expanded rail row
  unreadDot: 8,
  wordmarkCap: { appBar: 17, rail: 20, splash: 20, minimum: 14 },
  monogramRail: 20, // cap height of the letters CR at the top of the medium rail
  sheetGrabber: { width: 32, height: 4 },
  switchTrack: { width: 44, height: 24 },
  switchThumb: 16,
  checkbox: 20,
  radio: 20,
  radioDot: 10,
  codeBox: { width: 48, height: 56 },
  meterPipFeed: 10, // pip height under a feed card
  meterPipPage: 12, // pip height on a page
  confidencePip: { width: 4, height: 10 },
  progress: 4,
  timelineNode: 12,
  listMarker: 4,
  pullIndicator: 24,
  pullThreshold: 64,
  pullMax: 96,
  doubleTapHeart: 96,
  mediaControl: 36, // the mute button
  playControl: 56, // the play block when autoplay is off
  mediaControlInset: 12,
  deadlineRingMin: 96,
  ring: { ticks: 30, innerShare: 0.34, outerShare: 0.48, tickShare: 0.04 }, // deadline ring geometry, as shares of its size
  meterPips: 10,
  confidencePips: 3,
  burstShape: 4, // each of the four shapes that leave a like
  repostBlock: 28, // the ink block behind the repost icon when reposted
  bubbleMaxShare: 0.78, // a message bubble's widest share of the thread
  shareCardMaxShare: 0.86, // a shared-item card's widest share of the thread
  attachmentPreview: 56,
  dayColumn: 48, // the day-count column of a ledger or calendar row
  canvasMinCell: 179, // a grid cell narrower than this never holds a canvas
  swipeAction: 88,
  heldBlur: 40, // blur radius of a held image on the admin item pages (C-HeldMedia); the only blur in the product
  drawingEmpty: 200, // the empty chair
  miniMap: 96,
  qrCode: 160,
  authButtonMax: 400, // the widest a sign-in provider button is drawn
  // layout widths
  rail: 220,
  railIcon: 72,
  feedColumn: 600,
  rightColumn: 320,
  columnGap: 48,
  contentMax: 1280,
  profileColumn: 935,
  officeContent: 640,
  actionCard: 320,
  exploreResults: 488,
  filterPanel: 280,
  messagesList: 360,
  longForm: 640,
  dialogMax: 480,
  popoverMin: 200,
  qrPopover: 240,
  toastMax: 480,
  tooltipMax: 240,
  desktopCanvasReserve: 224, // the canvas is min(feedColumn, 0.8 x (viewport height - this)) wide at expanded
  // map marks
  pin: { large: 36, medium: 28, small: 20 },
  pinGlyphShare: 0.6,
  pinGlyphFrom: 28,
  countBubble: 24,
  pinHitRadius: 22,
} as const;

export const breakpoints = {
  medium: 600, // compact is under this (bottom tab bar)
  expanded: 1024, // medium is 600 to 1023 (icon rail); expanded is this and up (labeled rail and right column)
} as const;

/** Stacking order. There is no elevation and no shadow anywhere. */
export const z = {
  base: 0,
  sticky: 10, // app bars, sticky footers, the tab bar, the rail
  bar: 20, // the GetAppBar
  scrim: 30,
  overlay: 40, // sheets and dialogs
  popover: 50, // popovers, menus, tooltips, address suggestions
  toast: 60,
  transition: 70, // the card-to-page overlay
} as const;

/** Text scaling limits. */
export const textScale = {
  maxLargeRoles: 1.3, // display, title and the numeral roles stop growing here
  tightFrom: 1.15, // with a width under gutter.narrowBelow, the four "tight" changes apply from this font scale
} as const;

/** Gesture timings that are not animations. */
export const gesture = {
  doubleTapMs: 250,
  tooltipHoverDelayMs: 500,
  longPressMs: 500,
} as const;

/**
 * Dimensions of the map's own marks, in pixels on the map. They live here because every visual
 * number is a token.
 */
export const mapStyle = {
  districtLine: 1.5,
  levelLine: 1.5,
  noDataLine: 1,
  faintLine: 1,
  hoverLine: 2,
  hoverCasing: 4.5,
  selectionLine: 3,
  selectionCasing: 7,
  youLine: 2,
  youCasing: 4.5,
  youDash: 5,
  youGap: 3,
  roadMinor: 1.2,
  roadHighway: 2.4,
  roadMinorFromZoom: 11,
  roadHighwayFromZoom: 7,
  parkFromZoom: 11,
  waterwayAtZoom8: 1,
  waterwayAtZoom14: 3,
  pinKeyline: 1.5,
  bubbleKeyline: 1.5,
  ringLine: 1.5,
  ringCasing: 4.5,
  ringGap: 4,
  bubbleRadius: 12,
  bubbleRadius3: 14,
  bubbleRadius4: 17,
  selectedPinLarge: 44,
  labelSize: 12,
  labelHalo: 2,
  labelMaxWidthEms: 8,
  youTagPadding: 4,
  collisionPadding: 8,
  controlInset: 12,
  legendMinWidth: 184,
  legendBar: 12,
  noticeMaxWidth: 280,
} as const;
