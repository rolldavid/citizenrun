/** Motion values. Springs are Reanimated springs. Durations are milliseconds. */
export const motion = {
  spring: {
    standard: { damping: 18, stiffness: 220, mass: 1 }, // sheets, the card-to-page transition, the selected pin
    snap: { damping: 26, stiffness: 420, mass: 1 }, // presses returning, chrome, rows, pins rising; replaces "playful"
    stamp: { damping: 44, stiffness: 1000, mass: 1 }, // commitments only: Run, Follow, Bookmark, Like
  },
  /** cubic-bezier control points: fades and rises. */
  easeOut: [0.2, 0, 0, 1],
  duration: {
    press: 90,
    rise: 180,
    burst: 240,
    sheet: 240,
    cardToPage: 280,
    gridToPost: 280,
    fade: 120, // also the whole of every animation under reduced motion
    photoFade: 150,
    pipStagger: 40,
    ringStagger: 20,
    pinStagger: 30,
    revealStep: 240,
    heartHold: 400,
    flagDip: 600,
    toastHold: 4000,
    pulse: 1200,
    mapPulse: 1400,
    levelCrossfade: 300,
    cameraFly: 1200,
  },
  scale: { press: 0.98, like: 1.15, done: 1.06, run: 1.08 },
  rotate: { run: 2 }, // degrees, counter-clockwise
  distance: { press: 1, riseNumber: 6, risePin: 6, riseSent: 12, riseIncoming: 8, burst: 12 },
} as const;

export type SpringName = keyof (typeof motion)['spring'];
export type AnimatedProperty = 'transform' | 'opacity';

/** The presets: every MO- entry that animates. MO-cut, MO-feed-enter and MO-tab-restore animate nothing and have no preset. */
export type MotionId =
  | 'press'
  | 'like'
  | 'follow'
  | 'run'
  | 'cardToPage'
  | 'gridToPost'
  | 'meters'
  | 'deadlineRing'
  | 'loading'
  | 'pullToRefresh'
  | 'sheet'
  | 'carousel'
  | 'map'
  | 'districtReveal'
  | 'messages'
  | 'toast';

export type MotionSpec = {
  animates: readonly AnimatedProperty[]; // always a subset of transform and opacity
  spring: SpringName | null; // the spring it lands on, where it has one
  durationMs: number | null; // its timed part; also its length where CSS transitions stand in for the spring
  staggerMs: number | null;
  loops: boolean;
};

export const MOTION_SPECS: Readonly<Record<MotionId, MotionSpec>> = {
  press: { animates: ['transform'], spring: 'snap', durationMs: 90, staggerMs: null, loops: false },
  like: {
    animates: ['transform', 'opacity'],
    spring: 'stamp',
    durationMs: 240,
    staggerMs: null,
    loops: false,
  },
  follow: {
    animates: ['transform'],
    spring: 'stamp',
    durationMs: 180,
    staggerMs: null,
    loops: false,
  },
  run: { animates: ['transform'], spring: 'stamp', durationMs: 180, staggerMs: null, loops: false },
  cardToPage: {
    animates: ['transform', 'opacity'],
    spring: null,
    durationMs: 280,
    staggerMs: null,
    loops: false,
  },
  gridToPost: {
    animates: ['transform', 'opacity'],
    spring: null,
    durationMs: 280,
    staggerMs: null,
    loops: false,
  },
  meters: {
    animates: ['transform', 'opacity'],
    spring: null,
    durationMs: 180,
    staggerMs: 40,
    loops: false,
  },
  deadlineRing: {
    animates: ['opacity'],
    spring: null,
    durationMs: 600,
    staggerMs: 20,
    loops: false,
  },
  loading: { animates: ['opacity'], spring: null, durationMs: 1200, staggerMs: null, loops: true },
  pullToRefresh: {
    animates: ['transform', 'opacity'],
    spring: 'stamp',
    durationMs: null,
    staggerMs: null,
    loops: false,
  },
  sheet: {
    animates: ['transform', 'opacity'],
    spring: 'standard',
    durationMs: 240,
    staggerMs: null,
    loops: false,
  },
  carousel: {
    animates: ['transform'],
    spring: null,
    durationMs: null,
    staggerMs: null,
    loops: false,
  },
  map: {
    animates: ['transform', 'opacity'],
    spring: 'snap',
    durationMs: 300,
    staggerMs: 30,
    loops: false,
  },
  districtReveal: {
    animates: ['transform', 'opacity'],
    spring: 'standard',
    durationMs: 240,
    staggerMs: 240,
    loops: false,
  },
  messages: {
    animates: ['transform', 'opacity'],
    spring: null,
    durationMs: 180,
    staggerMs: null,
    loops: false,
  },
  toast: { animates: ['opacity'], spring: null, durationMs: 120, staggerMs: null, loops: false },
};

/** What every preset becomes when the system asks for reduced motion. */
export const REDUCED_MOTION_SPEC: MotionSpec = {
  animates: ['opacity'],
  spring: null,
  durationMs: 120,
  staggerMs: null,
  loops: false,
};

/** The spec to run: the preset's own, or the 120 ms fade under reduced motion. */
export function resolveMotion(id: MotionId, reducedMotion: boolean): MotionSpec {
  return reducedMotion ? REDUCED_MOTION_SPEC : MOTION_SPECS[id];
}
