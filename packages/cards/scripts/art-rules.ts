// CARD-art-rules as data. The lint, the SVGR color mapping and the generated prop types all read this
// file, so the three cannot disagree; no other code states these values (D-276).

export type ArtGroup = 'offices' | 'pins' | 'issues';
export const ART_GROUPS: readonly ArtGroup[] = ['offices', 'pins', 'issues'];
export type SentinelRole = 'ink' | 'paper' | 'tone' | 'spot' | 'fill';
export type ArtElement = 'rect' | 'circle' | 'path';
export type ArtGroupRules = {
  /** The source folder, relative to the package. */
  folder: string;
  viewBox: string;
  /** Root attributes besides `xmlns` and `viewBox`. */
  rootAttributes: { required: readonly string[]; optional: readonly string[] };
  /** The allowed attributes of each allowed element. */
  elements: Readonly<Partial<Record<ArtElement, readonly string[]>>>;
  /** Sentinel hex color to the role prop it becomes. */
  sentinels: Readonly<Record<string, SentinelRole>>;
  elementLimit: number;
  numbers: 'half-units' | 'three-decimals';
  extent: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    appliesTo: readonly ArtElement[];
  };
  propsType: 'OfficeArtRoles' | 'GlyphProps';
  mapName: 'OFFICE_ART' | 'PIN_GLYPHS' | 'ISSUE_ICONS';
};

const PATH_ATTRIBUTES: readonly string[] = ['d', 'fill', 'fill-rule'];
const ONE_COLOR: Readonly<Record<string, SentinelRole>> = { '#111111': 'fill' };

export const ART_RULES: Readonly<Record<ArtGroup, ArtGroupRules>> = {
  offices: {
    folder: 'art/offices',
    viewBox: '0 0 96 96',
    rootAttributes: { required: ['data-crop', 'data-spot'], optional: ['data-placeholder-of'] },
    elements: {
      rect: ['x', 'y', 'width', 'height', 'fill'],
      circle: ['cx', 'cy', 'r', 'fill'],
      path: PATH_ATTRIBUTES,
    },
    sentinels: { '#111111': 'ink', '#FFFFFF': 'paper', '#7A7A7A': 'tone', '#D93A1E': 'spot' },
    elementLimit: 12,
    numbers: 'half-units',
    extent: { minX: 2, maxX: 94, minY: 0, maxY: 92, appliesTo: ['rect', 'circle'] },
    propsType: 'OfficeArtRoles',
    mapName: 'OFFICE_ART',
  },
  pins: {
    folder: 'art/pins',
    viewBox: '0 0 24 24',
    rootAttributes: { required: [], optional: ['data-placeholder-of'] },
    elements: { path: PATH_ATTRIBUTES },
    sentinels: ONE_COLOR,
    elementLimit: 6,
    numbers: 'three-decimals',
    extent: { minX: 0, maxX: 24, minY: 0, maxY: 24, appliesTo: ['path'] },
    propsType: 'GlyphProps',
    mapName: 'PIN_GLYPHS',
  },
  issues: {
    folder: 'art/issues',
    viewBox: '0 0 24 24',
    rootAttributes: { required: [], optional: [] },
    elements: { path: PATH_ATTRIBUTES },
    sentinels: ONE_COLOR,
    elementLimit: 4,
    numbers: 'three-decimals',
    extent: { minX: 0, maxX: 24, minY: 0, maxY: 24, appliesTo: ['path'] },
    propsType: 'GlyphProps',
    mapName: 'ISSUE_ICONS',
  },
};

/** Any attribute that starts with one of these is forbidden, on the root or a child. */
export const FORBIDDEN_ATTRIBUTE_PREFIXES: readonly string[] = ['stroke'];
/** Attributes forbidden on the root and on every child. */
export const FORBIDDEN_ATTRIBUTES: readonly string[] = [
  'style',
  'class',
  'id',
  'transform',
  'opacity',
  'fill-opacity',
  'clip-path',
  'mask',
  'filter',
];
/** `data-crop` of an office drawing: the grid x where a canvas's right edge falls. */
export const CROP_RANGE = { min: 72, max: 88, step: 0.5 } as const;
/** `data-spot` of an office drawing: the spot's longer and shorter sides. */
export const SPOT_SIZE = { longMin: 10, longMax: 24, shortMin: 6 } as const;
