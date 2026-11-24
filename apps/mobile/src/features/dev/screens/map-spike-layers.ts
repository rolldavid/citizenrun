import type {
  LngLat,
  LngLatBounds,
  MapGeoJsonSource,
  MapLayerSpec,
  MapVectorSource,
  StyleExpression,
  StyleTransition,
  StyleValue,
} from '@/platform/map';
import { motion } from '@/ui/motion';
import type { Theme } from '@/ui/theme';
import { mapStyle, opacity, rule, size } from '@/ui/tokens';
import { typography } from '@/ui/typography';

// The map spike's own data layers, sources and camera boxes (D-100 row 6). Pure: tokens and state in,
// plain JSON out. Deleted with the real map screen.

/** How the spike's tile host answers a tile it has no data for. */
export type EmptyMode = '204' | '200' | '404';
export type SpikeRegion = 'spike' | 'alaska';
export type MapSpikeToggles = {
  dimmed: boolean;
  ringsFaded: boolean;
  filtered: boolean;
  tagsHidden: boolean;
};

/** The fixture tile 8/71/100, which holds the nine cells. */
export const SPIKE_BOUNDS: LngLatBounds = [-80.15625, 35.4607, -78.75, 36.5979];
/** The fixture tile's centre, beside cell 5's point. */
export const SPIKE_CENTRE: LngLat = [-79.4531, 36.0283];
/** The lower 48's `max` box (MAP-regions). */
export const LOWER48_MAX: LngLatBounds = [-131.0, 20.5, -60.5, 52.5];
/** Alaska's `fit` box (MAP-regions). */
export const ALASKA_FIT: LngLatBounds = [-169.0, 53.5, -129.5, 71.5];
/** Alaska's `max` box (MAP-regions): its west edge is 172 degrees east, across the antimeridian. */
export const ALASKA_MAX: LngLatBounds = [-188.0, 50.5, -128.0, 72.5];
export const SPIKE_MIN_ZOOM = 3; // D-201
export const SPIKE_MAX_ZOOM = 16; // D-201

const VECTOR_SOURCE = 'spike';
const GEO_SOURCE = 'spike-geo';

/** The three font stacks the glyph host serves; a `text-font` names exactly one of them (D-201). */
const FONT_REGULAR = 'Noto Sans Regular';
const FONT_BOLD = 'Noto Sans Bold';

/** The spike style of a theme on the host at `origin`, answering an empty tile by `empty`. */
export function spikeStyleUrl(origin: string, theme: 'light' | 'dark', empty: EmptyMode): string {
  return `${origin}/style-${theme}.json?empty=${empty}`;
}

/**
 * The style's own vector source, listed again with the same id and tile address, so a phone has a
 * source component to hang its layers and feature state on (PM-map-spike).
 */
export function spikeVectorSource(origin: string, empty: EmptyMode): MapVectorSource {
  return {
    id: VECTOR_SOURCE,
    tiles: [`${origin}/tiles/{z}/{x}/{y}.pbf?empty=${empty}`],
    minzoom: 0,
    maxzoom: 8,
  };
}

function lineData(
  firstId: number,
  ends: readonly [{ at: LngLat; name: string }, { at: LngLat; name: string }],
): MapGeoJsonSource {
  const [from, to] = ends;
  return {
    id: GEO_SOURCE,
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: firstId,
          geometry: { type: 'LineString', coordinates: [from.at, to.at] },
          properties: { name: null },
        },
        {
          type: 'Feature',
          id: firstId + 1,
          geometry: { type: 'Point', coordinates: from.at },
          properties: { name: from.name },
        },
        {
          type: 'Feature',
          id: firstId + 2,
          geometry: { type: 'Point', coordinates: to.at },
          properties: { name: to.name },
        },
      ],
    },
  };
}

/**
 * The GeoJSON source the screen swaps at run time: one line and its two named ends. `a` runs west to
 * east and `b` north to south, both through the middle of the cells. The names are fixture names.
 */
export function spikeGeoJson(variant: 'a' | 'b'): MapGeoJsonSource {
  return variant === 'a'
    ? lineData(1, [
        { at: [-79.8, 36.03], name: 'West end' },
        { at: [-79.1, 36.03], name: 'East end' },
      ])
    : lineData(11, [
        { at: [-79.45, 36.37], name: 'North end' },
        { at: [-79.45, 35.69], name: 'South end' },
      ]);
}

/**
 * The web attribution control drawn as a chip (MAP-attribution): a stylesheet that reads only custom
 * properties, and their values from the tokens.
 */
export function spikeWebStyle(colors: Theme['color']): {
  css: string;
  cssVariables: Readonly<Record<string, string>>;
} {
  const mono = typography.mono.style;
  return {
    css:
      '.maplibregl-ctrl.maplibregl-ctrl-attrib{background:var(--spike-attrib-bg);' +
      'color:var(--spike-attrib-text);' +
      'border:var(--spike-attrib-line) solid var(--spike-attrib-rule);border-radius:0;' +
      'font-family:var(--spike-attrib-font);font-size:var(--spike-attrib-size)}' +
      '.maplibregl-ctrl-attrib a{color:var(--spike-attrib-text);text-decoration:none}',
    cssVariables: {
      '--spike-attrib-bg': colors.surface,
      '--spike-attrib-text': colors.textSecondary,
      '--spike-attrib-rule': colors.rule,
      '--spike-attrib-line': `${String(rule.hairline)}px`,
      ...(mono.fontFamily === undefined ? {} : { '--spike-attrib-font': mono.fontFamily }),
      ...(mono.fontSize === undefined
        ? {}
        : { '--spike-attrib-size': `${String(mono.fontSize)}px` }),
    },
  };
}

function rampStep(ramp: readonly string[], index: number): string {
  const value = ramp[index];
  if (value === undefined) {
    throw new Error('a map ramp has five steps');
  }
  return value;
}

type LayerParts = Pick<MapLayerSpec, 'id' | 'type' | 'source' | 'sourceLayer' | 'before'> & {
  filter?: StyleExpression;
  layout?: Readonly<Record<string, StyleValue>>;
  paint: Readonly<Record<string, StyleValue>>;
};

/** A spike layer: every zoom, and drawn on phones as on the web. */
function layer(parts: LayerParts): MapLayerSpec {
  return {
    id: parts.id,
    type: parts.type,
    source: parts.source,
    sourceLayer: parts.sourceLayer,
    before: parts.before,
    minzoom: null,
    maxzoom: null,
    filter: parts.filter ?? null,
    layout: parts.layout ?? {},
    paint: parts.paint,
    webOnly: false,
  };
}

/**
 * The spike's ten data layers, bottom to top within each anchor: the cells and their outlines, the
 * swapped line, then rings, pins, the invisible hit circles and the two label layers. Every animated
 * value is a constant whose transition is declared here and never changes for a mounted surface; only
 * `reducedMotion` changes one, and the screen remounts the surface for it (D-201).
 */
export function buildSpikeLayers(input: {
  colors: Theme['color'];
  ramp: readonly string[];
  toggles: MapSpikeToggles;
  reducedMotion: boolean;
}): MapLayerSpec[] {
  const { colors, ramp, toggles, reducedMotion } = input;
  const transition = (duration: number): StyleTransition =>
    reducedMotion ? { duration: 0, delay: 0 } : { duration, delay: motion.duration.rise };
  const labelVisibility = toggles.tagsHidden ? 'none' : 'visible';
  const isLine: StyleExpression = ['==', ['geometry-type'], 'LineString'];
  const isPoint: StyleExpression = ['==', ['geometry-type'], 'Point'];
  // The tag sits above the largest pin and its ring.
  const tagLift =
    (size.pin.large / 2 + mapStyle.ringGap + mapStyle.youTagPadding) / mapStyle.labelSize;

  return [
    layer({
      id: 'spike-cells-fill',
      type: 'fill',
      source: VECTOR_SOURCE,
      sourceLayer: 'cells',
      before: 'anchor-fill',
      ...(toggles.filtered ? { filter: ['match', ['id'], [1, 2, 3], true, false] } : {}),
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false],
          rampStep(ramp, 4),
          ['step', ['get', 'n'], rampStep(ramp, 0), 4, rampStep(ramp, 1), 7, rampStep(ramp, 2)],
        ],
        'fill-opacity': toggles.dimmed ? opacity.mapDim : 1,
        'fill-opacity-transition': transition(motion.duration.levelCrossfade),
      },
    }),
    layer({
      id: 'spike-cells-casing',
      type: 'line',
      source: VECTOR_SOURCE,
      sourceLayer: 'cells',
      before: 'anchor-line',
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': colors.mapLineCasing, 'line-width': mapStyle.youCasing },
    }),
    layer({
      id: 'spike-cells-dash',
      type: 'line',
      source: VECTOR_SOURCE,
      sourceLayer: 'cells',
      before: 'anchor-line',
      layout: { 'line-join': 'miter', 'line-cap': 'butt' },
      paint: {
        'line-color': colors.mapYou,
        'line-width': mapStyle.youLine,
        // In units of the line's width.
        'line-dasharray': [mapStyle.youDash / mapStyle.youLine, mapStyle.youGap / mapStyle.youLine],
      },
    }),
    layer({
      id: 'spike-geo-casing',
      type: 'line',
      source: GEO_SOURCE,
      sourceLayer: null,
      before: 'anchor-line',
      filter: isLine,
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': colors.mapLineCasing, 'line-width': mapStyle.selectionCasing },
    }),
    layer({
      id: 'spike-geo-line',
      type: 'line',
      source: GEO_SOURCE,
      sourceLayer: null,
      before: 'anchor-line',
      filter: isLine,
      layout: { 'line-join': 'miter' },
      paint: { 'line-color': colors.mapSelection, 'line-width': mapStyle.selectionLine },
    }),
    layer({
      id: 'spike-rings',
      type: 'circle',
      source: VECTOR_SOURCE,
      sourceLayer: 'points',
      before: 'anchor-top',
      paint: {
        'circle-radius': size.pin.large / 2 + mapStyle.ringGap,
        'circle-opacity': 0,
        'circle-stroke-width': mapStyle.ringLine,
        'circle-stroke-color': colors.mapPulse,
        'circle-stroke-opacity': toggles.ringsFaded ? opacity.pulseLow : 1,
        'circle-stroke-opacity-transition': transition(motion.duration.mapPulse),
      },
    }),
    layer({
      id: 'spike-points',
      type: 'circle',
      source: VECTOR_SOURCE,
      sourceLayer: 'points',
      before: 'anchor-top',
      paint: {
        'circle-radius': [
          'step',
          ['%', ['id'], 6],
          size.pin.small / 2,
          2,
          size.pin.medium / 2,
          4,
          size.pin.large / 2,
        ],
        'circle-color': colors.pinBg,
        'circle-stroke-color': colors.pinKeyline,
        'circle-stroke-width': mapStyle.pinKeyline,
      },
    }),
    layer({
      id: 'spike-hit',
      type: 'circle',
      source: VECTOR_SOURCE,
      sourceLayer: 'points',
      before: 'anchor-top',
      paint: { 'circle-radius': size.pinHitRadius, 'circle-opacity': 0 },
    }),
    layer({
      id: 'spike-tags',
      type: 'symbol',
      source: VECTOR_SOURCE,
      sourceLayer: 'points',
      before: 'anchor-top',
      layout: {
        visibility: labelVisibility,
        'text-field': ['concat', 'Cell ', ['to-string', ['max', ['coalesce', ['get', 'n'], 0], 1]]],
        'text-font': [FONT_BOLD],
        'text-size': mapStyle.labelSize,
        'text-anchor': 'bottom',
        'text-offset': [0, -tagLift],
        'icon-image': 'map-box',
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [
          mapStyle.youTagPadding,
          mapStyle.youTagPadding,
          mapStyle.youTagPadding,
          mapStyle.youTagPadding,
        ],
        'text-allow-overlap': true,
        'icon-allow-overlap': true,
      },
      paint: { 'text-color': colors.inverseText, 'icon-color': colors.inverseBg },
    }),
    layer({
      id: 'spike-geo-label',
      type: 'symbol',
      source: GEO_SOURCE,
      sourceLayer: null,
      before: 'anchor-top',
      filter: isPoint,
      layout: {
        visibility: labelVisibility,
        'text-field': ['get', 'name'],
        'text-font': [FONT_REGULAR],
        'text-size': mapStyle.labelSize,
        'text-anchor': 'top',
        'text-offset': [0, 1],
      },
      paint: {
        'text-color': colors.mapLabel,
        'text-halo-color': colors.mapLabelHalo,
        'text-halo-width': mapStyle.labelHalo,
      },
    }),
  ];
}
