import { color, mapStyle } from '@citizenrun/shared';
import type { EmptyMode } from './tiles.ts';

export type SpikeTheme = 'light' | 'dark';

/** The parts of a MapLibre style the spike writes. */
export type SpikeStyle = {
  version: 8;
  name: string;
  glyphs: string;
  sprite: string;
  sources: Record<string, unknown>;
  layers: Record<string, unknown>[];
};

/** The OpenFreeMap base by its TileJSON, never a dated tile path (D-207). */
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/** The empty background layers the data layers are placed between, in style order. */
export const SPIKE_ANCHORS = ['anchor-fill', 'anchor-line', 'anchor-top'] as const;

/** The three font stacks the glyph host serves; a `text-font` names exactly one of them (D-201). */
const FONT_REGULAR = 'Noto Sans Regular';
const FONT_ITALIC = 'Noto Sans Italic';

const BASE_SOURCE = 'openmaptiles';
const NOT_A_TUNNEL = ['!=', ['get', 'brunnel'], 'tunnel'];
const ROUND_LINE = { 'line-cap': 'round', 'line-join': 'round' };

/** The spike's own vector tiles on the host at `origin`, answering an empty tile by `empty`. */
export function spikeTileTemplate(origin: string, empty: EmptyMode): string {
  return `${origin}/tiles/{z}/{x}/{y}.pbf?empty=${empty}`;
}

/**
 * The hand-written spike style over the OpenFreeMap base, bottom to top: land, water, highways and
 * state lines, then state and city names, with the three anchors between them. Light and dark
 * differ only in color values.
 */
export function buildSpikeStyle(input: {
  theme: SpikeTheme;
  origin: string;
  empty: EmptyMode;
}): SpikeStyle {
  const T = color[input.theme];
  const D = mapStyle;

  /** An invisible layer that only marks a place in the order. */
  const anchor = (id: (typeof SPIKE_ANCHORS)[number]): Record<string, unknown> => ({
    id,
    type: 'background',
    layout: { visibility: 'none' },
    paint: { 'background-color': T.mapLand },
  });

  /** A place label: one font, read against its halo. */
  const label = (font: string, textColor: string): Record<string, unknown> => ({
    layout: {
      'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
      'text-font': [font],
      'text-size': D.labelSize,
      'text-max-width': D.labelMaxWidthEms,
    },
    paint: {
      'text-color': textColor,
      'text-halo-color': T.mapLabelHalo,
      'text-halo-width': D.labelHalo,
    },
  });

  return {
    version: 8,
    name: input.theme === 'light' ? 'spike-light' : 'spike-dark',
    glyphs: OPENFREEMAP_GLYPHS,
    sprite: `${input.origin}/sprite`,
    sources: {
      [BASE_SOURCE]: { type: 'vector', url: OPENFREEMAP_TILEJSON },
      spike: {
        type: 'vector',
        tiles: [spikeTileTemplate(input.origin, input.empty)],
        minzoom: 0,
        maxzoom: 8,
      },
    },
    layers: [
      { id: 'base-land', type: 'background', paint: { 'background-color': T.mapLand } },
      anchor('anchor-fill'),
      {
        id: 'base-water',
        type: 'fill',
        source: BASE_SOURCE,
        'source-layer': 'water',
        filter: NOT_A_TUNNEL,
        paint: { 'fill-color': T.mapWater },
      },
      {
        id: 'base-road-highway',
        type: 'line',
        source: BASE_SOURCE,
        'source-layer': 'transportation',
        minzoom: D.roadHighwayFromZoom,
        filter: [
          'all',
          ['match', ['get', 'class'], ['motorway', 'trunk'], true, false],
          NOT_A_TUNNEL,
        ],
        layout: ROUND_LINE,
        paint: { 'line-color': T.mapRoad, 'line-width': D.roadHighway },
      },
      {
        id: 'base-boundary-state',
        type: 'line',
        source: BASE_SOURCE,
        'source-layer': 'boundary',
        minzoom: 3,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        layout: ROUND_LINE,
        paint: { 'line-color': T.mapLevelLine, 'line-width': D.levelLine },
      },
      anchor('anchor-line'),
      {
        id: 'base-label-state',
        type: 'symbol',
        source: BASE_SOURCE,
        'source-layer': 'place',
        minzoom: 3,
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'state'],
        ...label(FONT_ITALIC, T.mapLabelSecondary),
      },
      {
        id: 'base-label-city',
        type: 'symbol',
        source: BASE_SOURCE,
        'source-layer': 'place',
        minzoom: 8,
        filter: ['==', ['get', 'class'], 'city'],
        ...label(FONT_REGULAR, T.mapLabel),
      },
      anchor('anchor-top'),
    ],
  };
}
