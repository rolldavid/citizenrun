import { color } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import {
  OPENFREEMAP_GLYPHS,
  OPENFREEMAP_TILEJSON,
  SPIKE_ANCHORS,
  buildSpikeStyle,
  spikeTileTemplate,
} from './style.ts';
import type { SpikeStyle, SpikeTheme } from './style.ts';

const THEMES: readonly SpikeTheme[] = ['light', 'dark'];

const LAYER_IDS = [
  'base-land',
  'anchor-fill',
  'base-water',
  'base-road-highway',
  'base-boundary-state',
  'anchor-line',
  'base-label-state',
  'base-label-city',
  'anchor-top',
];

const HOSTED_FONTS = ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic'];

function styleOf(theme: SpikeTheme): SpikeStyle {
  return buildSpikeStyle({ theme, origin: 'http://h:8091', empty: '204' });
}

function layerOf(style: SpikeStyle, id: string): Record<string, unknown> {
  const layer = style.layers.find((entry) => entry['id'] === id);
  if (layer === undefined) {
    throw new Error(`the style has no layer ${id}`);
  }
  return layer;
}

function isColorString(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('#') || value.startsWith('rgb'));
}

/** Every string anywhere inside a JSON value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

/** The same JSON with every string that is a color of the theme replaced by its token's name. */
function withTokenNames(value: unknown, theme: SpikeTheme): unknown {
  if (typeof value === 'string') {
    const token = Object.entries(color[theme]).find(([, hex]) => hex === value);
    return token === undefined ? value : `token:${token[0]}`;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => withTokenNames(entry, theme));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, withTokenNames(entry, theme)]),
    );
  }
  return value;
}

describe('buildSpikeStyle', () => {
  it('nine base layers and the anchors in order', () => {
    for (const theme of THEMES) {
      expect(styleOf(theme).layers.map((layer) => layer['id'])).toEqual(LAYER_IDS);
    }
    expect(LAYER_IDS.filter((id) => id.startsWith('anchor-'))).toEqual([...SPIKE_ANCHORS]);
  });

  it('light and dark differ only in colors', () => {
    const { name: lightName, ...light } = styleOf('light');
    const { name: darkName, ...dark } = styleOf('dark');
    expect(lightName).toBe('spike-light');
    expect(darkName).toBe('spike-dark');
    expect(light).not.toEqual(dark);
    expect(withTokenNames(light, 'light')).toEqual(withTokenNames(dark, 'dark'));
  });

  it('only token colors', () => {
    for (const theme of THEMES) {
      const colors = stringsIn(styleOf(theme).layers).filter(isColorString);
      const allowed = new Set(Object.values(color[theme]));
      expect(colors.length).toBeGreaterThan(0);
      expect(colors.filter((value) => !allowed.has(value))).toEqual([]);
    }
  });

  it('each base layer is drawn in its own map token', () => {
    for (const theme of THEMES) {
      const T = color[theme];
      const style = styleOf(theme);
      expect(layerOf(style, 'base-land')['paint']).toEqual({ 'background-color': T.mapLand });
      expect(layerOf(style, 'base-water')['paint']).toEqual({ 'fill-color': T.mapWater });
      expect(layerOf(style, 'base-road-highway')['paint']).toEqual({
        'line-color': T.mapRoad,
        'line-width': 2.4,
      });
      expect(layerOf(style, 'base-boundary-state')['paint']).toEqual({
        'line-color': T.mapLevelLine,
        'line-width': 1.5,
      });
      expect(layerOf(style, 'base-label-state')['paint']).toEqual({
        'text-color': T.mapLabelSecondary,
        'text-halo-color': T.mapLabelHalo,
        'text-halo-width': 2,
      });
      expect(layerOf(style, 'base-label-city')['paint']).toEqual({
        'text-color': T.mapLabel,
        'text-halo-color': T.mapLabelHalo,
        'text-halo-width': 2,
      });
    }
  });

  it('each layer reads its source layer, zooms and filter', () => {
    const style = styleOf('light');
    const facts = style.layers.map((layer) => ({
      id: layer['id'],
      type: layer['type'],
      source: layer['source'],
      sourceLayer: layer['source-layer'],
      minzoom: layer['minzoom'],
      maxzoom: layer['maxzoom'],
      filter: layer['filter'],
    }));
    const none = {
      source: undefined,
      sourceLayer: undefined,
      minzoom: undefined,
      maxzoom: undefined,
      filter: undefined,
    };
    expect(facts).toEqual([
      { ...none, id: 'base-land', type: 'background' },
      { ...none, id: 'anchor-fill', type: 'background' },
      {
        ...none,
        id: 'base-water',
        type: 'fill',
        source: 'openmaptiles',
        sourceLayer: 'water',
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      },
      {
        ...none,
        id: 'base-road-highway',
        type: 'line',
        source: 'openmaptiles',
        sourceLayer: 'transportation',
        minzoom: 7,
        filter: [
          'all',
          ['match', ['get', 'class'], ['motorway', 'trunk'], true, false],
          ['!=', ['get', 'brunnel'], 'tunnel'],
        ],
      },
      {
        ...none,
        id: 'base-boundary-state',
        type: 'line',
        source: 'openmaptiles',
        sourceLayer: 'boundary',
        minzoom: 3,
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      },
      { ...none, id: 'anchor-line', type: 'background' },
      {
        ...none,
        id: 'base-label-state',
        type: 'symbol',
        source: 'openmaptiles',
        sourceLayer: 'place',
        minzoom: 3,
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'state'],
      },
      {
        ...none,
        id: 'base-label-city',
        type: 'symbol',
        source: 'openmaptiles',
        sourceLayer: 'place',
        minzoom: 8,
        filter: ['==', ['get', 'class'], 'city'],
      },
      { ...none, id: 'anchor-top', type: 'background' },
    ]);
  });

  it('the anchors draw nothing and the lines are round', () => {
    for (const theme of THEMES) {
      const style = styleOf(theme);
      for (const id of SPIKE_ANCHORS) {
        const anchor = layerOf(style, id);
        expect(anchor['layout']).toEqual({ visibility: 'none' });
        expect(anchor['paint']).toEqual({ 'background-color': color[theme].mapLand });
      }
      for (const id of ['base-road-highway', 'base-boundary-state']) {
        expect(layerOf(style, id)['layout']).toEqual({
          'line-cap': 'round',
          'line-join': 'round',
        });
      }
    }
  });

  it('one font per stack, from the hosted three', () => {
    for (const theme of THEMES) {
      const symbols = styleOf(theme).layers.filter((layer) => layer['type'] === 'symbol');
      expect(symbols.map((layer) => layer['id'])).toEqual(['base-label-state', 'base-label-city']);
      for (const layer of symbols) {
        const layout = layer['layout'] as Record<string, unknown>; // the style writes a layout on every symbol layer
        const fonts = layout['text-font'];
        expect(Array.isArray(fonts) && fonts.length === 1).toBe(true);
        expect(HOSTED_FONTS).toContain((fonts as string[])[0]); // checked to be an array on the line above
      }
    }
    const light = styleOf('light');
    expect(layerOf(light, 'base-label-state')['layout']).toEqual({
      'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
      'text-font': ['Noto Sans Italic'],
      'text-size': 12,
      'text-max-width': 8,
    });
    expect(layerOf(light, 'base-label-city')['layout']).toEqual({
      'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-max-width': 8,
    });
  });

  it('nothing the libraries disagree on', () => {
    for (const theme of THEMES) {
      const style = styleOf(theme);
      for (const key of ['projection', 'sky', 'terrain', 'light', 'state', 'transition']) {
        expect(Object.hasOwn(style, key)).toBe(false);
      }
      expect(JSON.stringify(style)).not.toContain('promoteId');
      expect(style.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
      expect(style.glyphs).toBe(OPENFREEMAP_GLYPHS);
      expect(style.sources['openmaptiles']).toEqual({
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      });
      expect(OPENFREEMAP_TILEJSON).toBe('https://tiles.openfreemap.org/planet');
      expect(style.version).toBe(8);
    }
  });

  it("the spike source matches the app's", () => {
    expect(spikeTileTemplate('http://h:8091', '204')).toBe(
      'http://h:8091/tiles/{z}/{x}/{y}.pbf?empty=204',
    );
    const style = buildSpikeStyle({ theme: 'dark', origin: 'http://h:8091', empty: '404' });
    expect(style.sources['spike']).toEqual({
      type: 'vector',
      tiles: ['http://h:8091/tiles/{z}/{x}/{y}.pbf?empty=404'],
      minzoom: 0,
      maxzoom: 8,
    });
    expect(style.sprite).toBe('http://h:8091/sprite');
  });
});
