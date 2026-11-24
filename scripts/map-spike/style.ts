import { color } from '@citizenrun/shared';
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

/** The spike's own vector tiles on the host at `origin`, answering an empty tile by `empty`. */
export function spikeTileTemplate(origin: string, empty: EmptyMode): string {
  return `${origin}/tiles/{z}/{x}/{y}.pbf?empty=${empty}`;
}

/** The hand-written spike style: the land, then the three anchors, over the OpenFreeMap base. */
export function buildSpikeStyle(input: {
  theme: SpikeTheme;
  origin: string;
  empty: EmptyMode;
}): SpikeStyle {
  const land = color[input.theme].mapLand;
  return {
    version: 8,
    name: input.theme === 'light' ? 'spike-light' : 'spike-dark',
    glyphs: OPENFREEMAP_GLYPHS,
    sprite: `${input.origin}/sprite`,
    sources: {
      openmaptiles: { type: 'vector', url: OPENFREEMAP_TILEJSON },
      spike: {
        type: 'vector',
        tiles: [spikeTileTemplate(input.origin, input.empty)],
        minzoom: 0,
        maxzoom: 8,
      },
    },
    layers: [
      { id: 'base-land', type: 'background', paint: { 'background-color': land } },
      ...SPIKE_ANCHORS.map((id) => ({
        id,
        type: 'background',
        layout: { visibility: 'none' },
        paint: { 'background-color': land },
      })),
    ],
  };
}
