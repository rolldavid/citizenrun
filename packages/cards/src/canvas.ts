// CARD-canvas: every number a canvas uses for a font size, a stroke width or a step table.
// Lint rule citizenrun/tokens-only is off in this file.

/** Special Gothic cap height in em: 710 of 1000 units. */
export const CAP_HEIGHT = 0.71;
/** The advance of every Chivo Mono glyph in em: 600 of 1000 units. */
export const MONO_ADVANCE = 0.6;

export const CANVAS = {
  width: 1080,
  height: 1350, // one reference canvas, 4:5
  margin: 66,
  measure: 948, // 1080 - 2 x 66
  heroMinHeight: 640, // office page hero
  preview: { width: 1200, height: 630, canvasWidth: 504 }, // D-274; 504 = 630 x 1080 / 1350
  minType: 40,
  thumbnailMinType: 72, // smallest type on a feed canvas and on a thumbnail
  // Each is false only when a phone draws tracked text, or a tilted group, unlike the server.
  trackingEnabled: false, // D-837: Android shifts tracked text by half its spacing
  stickerTiltEnabled: true,
  photoSlotEnabled: false, // the photo variant: off until the ten-portrait test passes
  track: { number: -0.03, title: -0.015, statement: -0.02, headline: -0.02, caps: 0.04 }, // em
  stroke: {
    mainRule: 4,
    divider: 3,
    keyline: 3,
    ringUnlit: 3,
    pager: 4,
    thumbRule: 5,
    previewRule: 2,
  },
  type: {
    bigNumber: { min: 168, max: 330 }, // fitted, not stepped
    bigAbout: 72, // the estimate word before the big number
    bigUnknown: [112, 96, 84], // the unknown phrase in the big slot, one line (PC7A-12)
    // [size, max lines]; line step size + 4
    title: [
      [92, 2],
      [76, 3],
      [64, 3],
      [64, 4],
    ],
    // line step round(size x 0.96)
    statement: [
      [150, 3],
      [124, 3],
      [104, 4],
    ],
    // line step round(size x 1.04)
    headline: [
      [112, 4],
      [96, 4],
      [84, 5],
    ],
    // New filing (PC7A-20)
    headlineFiling: [
      [112, 3],
      [96, 4],
      [84, 4],
      [72, 5],
    ],
    // Nationwide story (PC7A-20)
    headlineStory: [
      [112, 3],
      [96, 3],
      [84, 4],
      [72, 4],
    ],
    // line step round(size x 1.04)
    titlePage: [
      [96, 3],
      [84, 3],
      [72, 4],
    ],
    fact: [100, 84, 72], // the two lower steps are PC7A-10
    unknown: [56, 48],
    caption: 44,
    text: 42,
    holderSecond: 40,
    mono: 40,
    posterSecond: 52,
    posterOffice: [64, 52, 44],
    deadlineCount: { min: 168, max: 330 },
    deadlineCaption: 56,
    deadlineCloses: [64, 56, 50],
    personName: 56,
    paragraph: 44,
    thumb: {
      tile: 120,
      icon: 84,
      title: [
        [104, 3],
        [88, 3],
      ],
      headline: [
        [104, 3],
        [88, 4],
        [72, 5],
      ],
      bigNumber: { min: 164, max: 264 },
      caption: 72,
      line: 72,
      statement: [
        [170, 3],
        [150, 4],
      ],
      office: 80,
      deadlineCount: { min: 264, max: 520 },
      deadlineCaption: 104,
      deadlineCloses: 88,
    },
    share: { caution: 42, wordmarkCap: 44, link: 40 },
    preview: {
      wordmarkCap: 30,
      title: [
        [64, 3],
        [52, 3],
      ],
      place: 34,
      handle: 30,
      deal: 38,
      link: 28,
      caution: 28,
    },
  },
  art: {
    box: 540,
    cropDefault: 88,
    filing: 340,
    story: 400,
    thumb: 320,
    bigIcon: 620,
    thumbIcon: 520,
    chairPreview: 400,
  },
  tile: { size: 56, icon: 38 },
  district: { posterMax: 450, posterMin: 300, posterOverhang: 0.14, location: 250, thumb: 420 },
} as const;

/** The photo slot of a canvas, in units; also the pixel size the server embeds. */
export const PHOTO_BOX = { x: 614, y: 86, width: 400, height: 500 } as const;

/** A number rounded to one decimal place, so the app and the server write the same markup. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
