import { describe, expect, it, vi } from 'vitest';

import type { MapLayerSpec } from '@/platform/map';
import { color, mapRamp } from '@/ui/tokens';

import {
  ALASKA_FIT,
  ALASKA_MAX,
  LOWER48_MAX,
  SPIKE_BOUNDS,
  SPIKE_CENTRE,
  SPIKE_MAX_ZOOM,
  SPIKE_MIN_ZOOM,
  buildSpikeLayers,
  spikeGeoJson,
  spikeStyleUrl,
  spikeVectorSource,
  spikeWebStyle,
} from './map-spike-layers';
import type { MapSpikeToggles } from './map-spike-layers';

// The motion entry loads Reanimated, which a test without a DOM cannot import. The layers read only
// its duration tokens, so the entry is replaced by those tokens alone.
vi.mock('@/ui/motion', async () => {
  const { motion } = await import('@citizenrun/shared');
  return { motion };
});

const LAYER_IDS = [
  'spike-cells-fill',
  'spike-cells-casing',
  'spike-cells-dash',
  'spike-geo-casing',
  'spike-geo-line',
  'spike-rings',
  'spike-points',
  'spike-hit',
  'spike-tags',
  'spike-geo-label',
];

const OFF: MapSpikeToggles = {
  dimmed: false,
  ringsFaded: false,
  filtered: false,
  tagsHidden: false,
};

const LIGHT = color.light;
const DARK = color.dark;
/** The five neutral steps of each theme, lightest data first. */
const LIGHT_RAMP = mapRamp.neutral.light;
const DARK_RAMP = mapRamp.neutral.dark;

function layersOf(
  theme: 'light' | 'dark',
  toggles: Partial<MapSpikeToggles> = {},
  reducedMotion = false,
): MapLayerSpec[] {
  return buildSpikeLayers({
    colors: color[theme],
    ramp: mapRamp.neutral[theme],
    toggles: { ...OFF, ...toggles },
    reducedMotion,
  });
}

/** The layer at a place in the draw order, counted from 1. */
function row(layers: readonly MapLayerSpec[], number: number): MapLayerSpec {
  const layer = layers[number - 1];
  if (layer === undefined) {
    throw new Error(`the spike has no layer ${String(number)}`);
  }
  return layer;
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

describe('buildSpikeLayers', () => {
  it('ten layers in draw order', () => {
    const layers = layersOf('light');
    expect(layers.map((layer) => layer.id)).toEqual(LAYER_IDS);
    expect(layers.map((layer) => layer.before)).toEqual([
      'anchor-fill',
      'anchor-line',
      'anchor-line',
      'anchor-line',
      'anchor-line',
      'anchor-top',
      'anchor-top',
      'anchor-top',
      'anchor-top',
      'anchor-top',
    ]);
    expect(layers.map((layer) => layer.type)).toEqual([
      'fill',
      'line',
      'line',
      'line',
      'line',
      'circle',
      'circle',
      'circle',
      'symbol',
      'symbol',
    ]);
    for (const layer of layers) {
      expect(layer.minzoom).toBeNull();
      expect(layer.maxzoom).toBeNull();
      expect(layer.webOnly).toBe(false);
    }
  });

  it("the cells are on the style's vector source", () => {
    const layers = layersOf('light');
    expect(layers.map((layer) => [layer.source, layer.sourceLayer])).toEqual([
      ['spike', 'cells'],
      ['spike', 'cells'],
      ['spike', 'cells'],
      ['spike-geo', null],
      ['spike-geo', null],
      ['spike', 'points'],
      ['spike', 'points'],
      ['spike', 'points'],
      ['spike', 'points'],
      ['spike-geo', null],
    ]);
  });

  it('the toggles change the right values', () => {
    const plain = layersOf('light');
    expect(row(plain, 1).paint['fill-opacity']).toBe(1);
    expect(row(plain, 6).paint['circle-stroke-opacity']).toBe(1);
    expect(plain.map((layer) => layer.filter)).toEqual([
      null,
      null,
      null,
      ['==', ['geometry-type'], 'LineString'],
      ['==', ['geometry-type'], 'LineString'],
      null,
      null,
      null,
      null,
      ['==', ['geometry-type'], 'Point'],
    ]);
    expect(plain.map((layer) => layer.layout['visibility'])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'visible',
      'visible',
    ]);

    const dimmed = layersOf('light', { dimmed: true });
    expect(row(dimmed, 1).paint['fill-opacity']).toBe(0.4);
    expect(row(dimmed, 1).paint['fill-opacity-transition']).toEqual({ duration: 300, delay: 180 });
    expect(dimmed.slice(1)).toEqual(plain.slice(1));

    const faded = layersOf('light', { ringsFaded: true });
    expect(row(faded, 6).paint['circle-stroke-opacity']).toBe(0.25);
    expect(row(faded, 6).paint['circle-stroke-opacity-transition']).toEqual({
      duration: 1400,
      delay: 180,
    });
    expect(faded.filter((_, index) => index !== 5)).toEqual(
      plain.filter((_, index) => index !== 5),
    );

    const filtered = layersOf('light', { filtered: true });
    expect(row(filtered, 1).filter).toEqual(['match', ['id'], [1, 2, 3], true, false]);
    expect(filtered.slice(1).map((layer) => layer.filter)).toEqual(
      plain.slice(1).map((layer) => layer.filter),
    );
    expect(row(filtered, 1).paint).toEqual(row(plain, 1).paint);

    const hidden = layersOf('light', { tagsHidden: true });
    expect(hidden.map((layer) => layer.layout['visibility'])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'none',
      'none',
    ]);
    expect(hidden.slice(0, 8)).toEqual(plain.slice(0, 8));
  });

  it('transitions have a delay, and none under reduced motion', () => {
    const moving = layersOf('light');
    expect(row(moving, 1).paint['fill-opacity-transition']).toEqual({ duration: 300, delay: 180 });
    expect(row(moving, 6).paint['circle-stroke-opacity-transition']).toEqual({
      duration: 1400,
      delay: 180,
    });

    const still = layersOf('light', {}, true);
    expect(row(still, 1).paint['fill-opacity-transition']).toEqual({ duration: 0, delay: 0 });
    expect(row(still, 6).paint['circle-stroke-opacity-transition']).toEqual({
      duration: 0,
      delay: 0,
    });
  });

  it('only the two animated layers declare a transition, and a toggle never changes it', () => {
    const transitionKeys = (layers: readonly MapLayerSpec[]): string[] =>
      layers.flatMap((layer) =>
        Object.keys(layer.paint)
          .filter((key) => key.endsWith('-transition'))
          .map((key) => `${layer.id} ${key}`),
      );
    expect(transitionKeys(layersOf('light'))).toEqual([
      'spike-cells-fill fill-opacity-transition',
      'spike-rings circle-stroke-opacity-transition',
    ]);
    const every = layersOf('dark', {
      dimmed: true,
      ringsFaded: true,
      filtered: true,
      tagsHidden: true,
    });
    expect(row(every, 1).paint['fill-opacity-transition']).toEqual({ duration: 300, delay: 180 });
    expect(row(every, 6).paint['circle-stroke-opacity-transition']).toEqual({
      duration: 1400,
      delay: 180,
    });
  });

  it('the expressions of item 4 are present', () => {
    const text = JSON.stringify(layersOf('light', { filtered: true }));
    for (const operator of [
      '"%"',
      '"step"',
      '"coalesce"',
      '"max"',
      '"to-string"',
      '"concat"',
      '"match"',
      '"feature-state"',
    ]) {
      expect(text).toContain(operator);
    }
  });

  it('the cells step through the ramp and the pins through three sizes', () => {
    const light = layersOf('light');
    expect(row(light, 1).paint['fill-color']).toEqual([
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      LIGHT_RAMP[4],
      ['step', ['get', 'n'], LIGHT_RAMP[0], 4, LIGHT_RAMP[1], 7, LIGHT_RAMP[2]],
    ]);
    expect(row(layersOf('dark'), 1).paint['fill-color']).toEqual([
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      DARK_RAMP[4],
      ['step', ['get', 'n'], DARK_RAMP[0], 4, DARK_RAMP[1], 7, DARK_RAMP[2]],
    ]);
    expect(row(light, 7).paint).toEqual({
      'circle-radius': ['step', ['%', ['id'], 6], 10, 2, 14, 4, 18],
      'circle-color': LIGHT.pinBg,
      'circle-stroke-color': LIGHT.pinKeyline,
      'circle-stroke-width': 1.5,
    });
    expect(row(light, 6).paint).toEqual({
      'circle-radius': 22,
      'circle-opacity': 0,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': LIGHT.mapPulse,
      'circle-stroke-opacity': 1,
      'circle-stroke-opacity-transition': { duration: 1400, delay: 180 },
    });
    expect(row(light, 8).paint).toEqual({ 'circle-radius': 22, 'circle-opacity': 0 });
  });

  it('the dash and the tag', () => {
    const layers = layersOf('light');
    expect(row(layers, 2).paint).toEqual({ 'line-color': LIGHT.mapLineCasing, 'line-width': 4.5 });
    expect(row(layers, 2).layout).toEqual({ 'line-join': 'miter' });
    expect(row(layers, 3).paint).toEqual({
      'line-color': LIGHT.mapYou,
      'line-width': 2,
      'line-dasharray': [2.5, 1.5],
    });
    expect(row(layers, 3).layout).toEqual({ 'line-join': 'miter', 'line-cap': 'butt' });

    const tags = row(layers, 9);
    expect(tags.layout['icon-image']).toBe('map-box');
    expect(tags.layout['icon-text-fit']).toBe('both');
    expect(tags.layout['icon-text-fit-padding']).toEqual([4, 4, 4, 4]);
    expect(tags.layout['text-field']).toEqual([
      'concat',
      'Cell ',
      ['to-string', ['max', ['coalesce', ['get', 'n'], 0], 1]],
    ]);
    expect(tags.layout['text-font']).toEqual(['Noto Sans Bold']);
    expect(tags.layout['text-size']).toBe(12);
    expect(tags.layout['text-anchor']).toBe('bottom');
    // 18 for the largest pin, 4 to its ring and 4 of padding, in ems of 12.
    const offset = tags.layout['text-offset'] as readonly number[]; // the layer writes two numbers
    expect(offset[0]).toBe(0);
    expect(offset[1]).toBeCloseTo(-26 / 12, 10);
    expect(tags.layout['text-allow-overlap']).toBe(true);
    expect(tags.layout['icon-allow-overlap']).toBe(true);
    expect(tags.paint).toEqual({ 'text-color': LIGHT.inverseText, 'icon-color': LIGHT.inverseBg });
    expect(row(layersOf('dark'), 9).paint).toEqual({
      'text-color': DARK.inverseText,
      'icon-color': DARK.inverseBg,
    });
    // The tag is ink on the ground in each theme: the two swap between light and dark.
    expect(LIGHT.inverseBg).toBe(DARK.inverseText);
    expect(LIGHT.inverseText).toBe(DARK.inverseBg);
  });

  it('the swapped line is the selection line over its casing, with haloed end labels', () => {
    const layers = layersOf('light');
    expect(row(layers, 4).paint).toEqual({ 'line-color': LIGHT.mapLineCasing, 'line-width': 7 });
    expect(row(layers, 5).paint).toEqual({ 'line-color': LIGHT.mapSelection, 'line-width': 3 });
    expect(row(layers, 4).layout).toEqual({ 'line-join': 'miter' });
    expect(row(layers, 5).layout).toEqual({ 'line-join': 'miter' });
    expect(row(layers, 10).layout).toEqual({
      visibility: 'visible',
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1],
    });
    expect(row(layers, 10).paint).toEqual({
      'text-color': LIGHT.mapLabel,
      'text-halo-color': LIGHT.mapLabelHalo,
      'text-halo-width': 2,
    });
  });

  it('only token colors, no accent', () => {
    const every: MapSpikeToggles = {
      dimmed: true,
      ringsFaded: true,
      filtered: true,
      tagsHidden: true,
    };
    for (const theme of ['light', 'dark'] as const) {
      const ramp = mapRamp.neutral[theme];
      expect(ramp).toHaveLength(5);
      const allowed = new Set([...Object.values(color[theme]), ...ramp]);
      const banned = new Set([
        color[theme].accent,
        color[theme].accentHover,
        color[theme].highlight,
      ]);
      for (const toggles of [OFF, every]) {
        const colors = stringsIn(layersOf(theme, toggles)).filter(
          (value) => value.startsWith('#') || value.startsWith('rgb'),
        );
        expect(colors.length).toBeGreaterThan(0);
        expect(colors.filter((value) => !allowed.has(value))).toEqual([]);
        expect(colors.filter((value) => banned.has(value))).toEqual([]);
      }
    }
  });

  it('refuses a ramp with fewer than five steps', () => {
    expect(() =>
      buildSpikeLayers({
        colors: color.light,
        ramp: LIGHT_RAMP.slice(0, 4),
        toggles: OFF,
        reducedMotion: false,
      }),
    ).toThrow('a map ramp has five steps');
  });
});

describe('the spike sources and camera boxes', () => {
  it('sources and camera boxes', () => {
    expect(spikeVectorSource('http://h:8091', '200')).toEqual({
      id: 'spike',
      tiles: ['http://h:8091/tiles/{z}/{x}/{y}.pbf?empty=200'],
      minzoom: 0,
      maxzoom: 8,
    });
    expect(spikeStyleUrl('http://h:8091', 'dark', '404')).toBe(
      'http://h:8091/style-dark.json?empty=404',
    );
    expect(spikeStyleUrl('http://localhost:8091', 'light', '204')).toBe(
      'http://localhost:8091/style-light.json?empty=204',
    );
    expect(ALASKA_MAX).toEqual([-188, 50.5, -128, 72.5]);
    expect(ALASKA_FIT).toEqual([-169, 53.5, -129.5, 71.5]);
    expect(LOWER48_MAX).toEqual([-131, 20.5, -60.5, 52.5]);
    expect(SPIKE_BOUNDS).toEqual([-80.15625, 35.4607, -78.75, 36.5979]);
    expect(SPIKE_CENTRE).toEqual([-79.4531, 36.0283]);
    expect(SPIKE_MIN_ZOOM).toBe(3);
    expect(SPIKE_MAX_ZOOM).toBe(16);
  });

  it('the spike area and its centre lie inside the lower 48 box', () => {
    const [west, south, east, north] = SPIKE_BOUNDS;
    const [maxWest, maxSouth, maxEast, maxNorth] = LOWER48_MAX;
    expect(west).toBeGreaterThan(maxWest);
    expect(south).toBeGreaterThan(maxSouth);
    expect(east).toBeLessThan(maxEast);
    expect(north).toBeLessThan(maxNorth);
    expect(SPIKE_CENTRE[0]).toBeGreaterThan(west);
    expect(SPIKE_CENTRE[0]).toBeLessThan(east);
    expect(SPIKE_CENTRE[1]).toBeGreaterThan(south);
    expect(SPIKE_CENTRE[1]).toBeLessThan(north);
  });

  it('the two line data sets', () => {
    const a = spikeGeoJson('a');
    expect(a.id).toBe('spike-geo');
    expect(a.data).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 1,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-79.8, 36.03],
              [-79.1, 36.03],
            ],
          },
          properties: { name: null },
        },
        {
          type: 'Feature',
          id: 2,
          geometry: { type: 'Point', coordinates: [-79.8, 36.03] },
          properties: { name: 'West end' },
        },
        {
          type: 'Feature',
          id: 3,
          geometry: { type: 'Point', coordinates: [-79.1, 36.03] },
          properties: { name: 'East end' },
        },
      ],
    });

    const b = spikeGeoJson('b');
    expect(b.id).toBe('spike-geo');
    expect(b.data).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 11,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-79.45, 36.37],
              [-79.45, 35.69],
            ],
          },
          properties: { name: null },
        },
        {
          type: 'Feature',
          id: 12,
          geometry: { type: 'Point', coordinates: [-79.45, 36.37] },
          properties: { name: 'North end' },
        },
        {
          type: 'Feature',
          id: 13,
          geometry: { type: 'Point', coordinates: [-79.45, 35.69] },
          properties: { name: 'South end' },
        },
      ],
    });
  });

  it('the attribution stylesheet holds no value', () => {
    const light = spikeWebStyle(color.light);
    expect(light.css).not.toContain('#');
    expect(light.css).not.toContain('px');
    expect(light.css.replaceAll('border-radius:0', '')).not.toMatch(/\d/);
    // Square at every corner: the library's own rule for the left corners is longer than the first.
    expect(light.css).toContain(
      '.maplibregl-ctrl-top-left>.maplibregl-ctrl-attrib.maplibregl-compact-show,' +
        '.maplibregl-ctrl-bottom-left>.maplibregl-ctrl-attrib.maplibregl-compact-show{border-radius:0}',
    );
    expect(light.css).toContain('.maplibregl-ctrl.maplibregl-ctrl-attrib{');
    expect(light.cssVariables).toEqual({
      '--spike-attrib-bg': LIGHT.surface,
      '--spike-attrib-text': LIGHT.textSecondary,
      '--spike-attrib-rule': LIGHT.rule,
      '--spike-attrib-line': '1px',
      '--spike-attrib-font': 'ChivoMono-Medium',
      '--spike-attrib-size': '12px',
    });
    // Every custom property the stylesheet reads has a value, and none is set that it does not read.
    const read = new Set([...light.css.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]));
    expect([...read].sort()).toEqual(Object.keys(light.cssVariables).sort());

    const dark = spikeWebStyle(color.dark);
    expect(dark.css).toBe(light.css);
    expect(dark.cssVariables['--spike-attrib-bg']).toBe(DARK.surface);
    expect(dark.cssVariables['--spike-attrib-text']).toBe(DARK.textSecondary);
    expect(dark.cssVariables['--spike-attrib-rule']).toBe(DARK.rule);
  });
});
