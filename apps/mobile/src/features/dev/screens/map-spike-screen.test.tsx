import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MapLayerSpec } from '@/platform/map';
import { mapFake } from '@/test/platform/map';
import type { MapFakeSurfaceProps } from '@/test/platform/map';
import { renderWithProviders, setViewport } from '@/test/render';
import { color } from '@/ui/tokens';

import {
  ALASKA_FIT,
  ALASKA_MAX,
  LOWER48_MAX,
  SPIKE_BOUNDS,
  SPIKE_CLOSE_BOUNDS,
  SPIKE_CENTRE,
} from './map-spike-layers';
import { MapSpikeScreen } from './map-spike-screen';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// An interface icon loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('an interface icon loads no asset');
  },
}));

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

const CONTROL_IDS = [
  'dev.map-spike-theme',
  'dev.map-spike-dim',
  'dev.map-spike-rings',
  'dev.map-spike-filter',
  'dev.map-spike-tags',
  'dev.map-spike-select',
  'dev.map-spike-geojson',
  'dev.map-spike-query-centre',
  'dev.map-spike-query-viewport',
  'dev.map-spike-lift',
  'dev.map-spike-empty',
  'dev.map-spike-region',
  'dev.map-spike-attribution-position',
  'dev.map-spike-attribution-compact',
];

const SELECT_CELL_5 = {
  op: 'setFeatureState',
  target: { sourceId: 'spike', sourceLayer: 'cells', id: 5 },
  state: { selected: true },
};

function draw(props: { apiOrigin?: string; spikeOrigin?: string | null } = {}): void {
  renderWithProviders(
    <MapSpikeScreen apiOrigin={props.apiOrigin ?? ''} spikeOrigin={props.spikeOrigin ?? null} />,
  );
}

/** What the surface was last given. */
function surface(): MapFakeSurfaceProps {
  const props = mapFake.lastSurfaceProps();
  if (props === null) {
    throw new Error('no surface has been drawn');
  }
  return props;
}

function layer(id: string): MapLayerSpec {
  const found = surface().layers.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`the surface has no layer ${id}`);
  }
  return found;
}

function geoIds(): (number | null)[] {
  const source = surface().geojsonSources[0];
  if (source === undefined) {
    throw new Error('the surface has no GeoJSON source');
  }
  return source.data.features.map((feature) => feature.id);
}

function press(testID: string): void {
  fireEvent.click(screen.getByTestId(testID));
}

function emit(status: Parameters<typeof mapFake.emitStatus>[0]): void {
  act(() => {
    mapFake.emitStatus(status);
  });
}

function line(testID: string): string | null {
  return screen.getByTestId(testID).textContent;
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

afterEach(() => {
  cleanup();
});

describe('MapSpikeScreen', () => {
  it('it draws the spike on the web origin', () => {
    draw();
    const props = surface();
    expect(props.styleUrl).toBe('http://localhost:8091/style-light.json?empty=204');
    expect(props.sources).toEqual([
      {
        id: 'spike',
        tiles: ['http://localhost:8091/tiles/{z}/{x}/{y}.pbf?empty=204'],
        minzoom: 0,
        maxzoom: 8,
      },
    ]);
    expect(props.geojsonSources.map((source) => source.id)).toEqual(['spike-geo']);
    expect(geoIds()).toEqual([1, 2, 3]);
    expect(props.layers.map((entry) => entry.id)).toEqual(LAYER_IDS);
    // A phone starts close on the nine cells, clear of the names at the line's ends and of the
    // attribution under them.
    expect(props.initialBounds).toEqual(SPIKE_CLOSE_BOUNDS);
    expect(props.initialPadding).toEqual({ top: 32, right: 32, bottom: 64, left: 32 });
    expect(props.maxBounds).toEqual(LOWER48_MAX);
    expect(props.minZoom).toBe(3);
    expect(props.maxZoom).toBe(16);
    expect(props.attributionPosition).toBe('bottom-right');
    expect(props.attributionCompact).toBe(true);
    expect(props.accessibilityLabel).toBe('Map spike: test layers over the base map');
    expect(props.testID).toBe('dev.map-spike-surface');
    expect(props.webStyle?.cssVariables['--spike-attrib-bg']).toBe(color.light.surface);
    expect(mapFake.mountCount()).toBe(1);
  });

  it('the heading and every control are drawn, in panel order', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Map spike');
    expect(screen.getByTestId('dev.map-spike')).toBeTruthy();
    const drawn = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('data-testid'))
      .filter((id) => id !== null);
    expect(drawn).toEqual(CONTROL_IDS);
    expect(line('dev.map-spike-origin')).toBe('server http://localhost:8091');
    expect(line('dev.map-spike-mode')).toBe('empty 204, region spike, line A');
    expect(line('dev.map-spike-query')).toBe('query none');
  });

  it('the status line follows the surface', () => {
    draw();
    expect(line('dev.map-spike-status')).toBe('loading');
    emit({ kind: 'ready', styleErrors: 2 });
    expect(line('dev.map-spike-status')).toBe('ready 2');
    emit({ kind: 'error', code: 'map.style_failed' });
    expect(line('dev.map-spike-status')).toBe('error map.style_failed');
  });

  it('selecting cell 5 sets feature state, again after a reload', () => {
    draw();
    // Nothing is set while the style is loading: the surface would drop it.
    expect(mapFake.calls).toEqual([]);
    emit({ kind: 'ready', styleErrors: 0 });
    expect(mapFake.calls).toEqual([{ ...SELECT_CELL_5, state: { selected: false } }]);

    press('dev.map-spike-select');
    expect(mapFake.calls.at(-1)).toEqual(SELECT_CELL_5);
    expect(mapFake.calls).toHaveLength(2);
    expect(screen.getByTestId('dev.map-spike-select').getAttribute('aria-label')).toBe(
      'Clear cell 5',
    );

    // A style reload: the surface reports loading, then ready again.
    emit({ kind: 'loading' });
    expect(mapFake.calls).toHaveLength(2);
    emit({ kind: 'ready', styleErrors: 0 });
    expect(mapFake.calls).toHaveLength(3);
    expect(mapFake.calls.at(-1)).toEqual(SELECT_CELL_5);
  });

  it('a toggle changes one paint value', () => {
    draw();
    const before = surface();
    expect(layer('spike-cells-fill').paint['fill-opacity']).toBe(1);
    press('dev.map-spike-dim');
    expect(layer('spike-cells-fill').paint['fill-opacity']).toBe(0.4);
    expect(layer('spike-cells-fill').paint['fill-opacity-transition']).toEqual({
      duration: 300,
      delay: 180,
    });
    expect(surface().layers.slice(1)).toEqual(before.layers.slice(1));
    expect(surface().styleUrl).toBe(before.styleUrl);
    // What did not change keeps its identity, so the surface has nothing else to compare.
    expect(surface().sources).toBe(before.sources);
    expect(surface().geojsonSources).toBe(before.geojsonSources);
    expect(surface().webStyle).toBe(before.webStyle);
    expect(mapFake.mountCount()).toBe(1);
    expect(screen.getByTestId('dev.map-spike-dim').getAttribute('aria-label')).toBe('Undim cells');
  });

  it('the other toggles reach their layers', () => {
    draw();
    press('dev.map-spike-rings');
    expect(layer('spike-rings').paint['circle-stroke-opacity']).toBe(0.25);
    press('dev.map-spike-filter');
    expect(layer('spike-cells-fill').filter).toEqual(['match', ['id'], [1, 2, 3], true, false]);
    press('dev.map-spike-tags');
    expect(layer('spike-tags').layout['visibility']).toBe('none');
    expect(layer('spike-geo-label').layout['visibility']).toBe('none');
    expect(mapFake.mountCount()).toBe(1);

    press('dev.map-spike-rings');
    press('dev.map-spike-filter');
    press('dev.map-spike-tags');
    expect(layer('spike-rings').paint['circle-stroke-opacity']).toBe(1);
    expect(layer('spike-cells-fill').filter).toBeNull();
    expect(layer('spike-tags').layout['visibility']).toBe('visible');
    expect(mapFake.mountCount()).toBe(1);
  });

  it('the empty mode and the region remount the surface', () => {
    draw();
    expect(mapFake.mountCount()).toBe(1);
    press('dev.map-spike-empty');
    expect(mapFake.mountCount()).toBe(2);
    expect(surface().styleUrl).toBe('http://localhost:8091/style-light.json?empty=200');
    expect(surface().sources[0]?.tiles).toEqual([
      'http://localhost:8091/tiles/{z}/{x}/{y}.pbf?empty=200',
    ]);
    expect(line('dev.map-spike-mode')).toBe('empty 200, region spike, line A');

    press('dev.map-spike-region');
    expect(mapFake.mountCount()).toBe(3);
    expect(surface().initialBounds).toEqual(ALASKA_FIT);
    expect(surface().maxBounds).toEqual(ALASKA_MAX);
    expect(line('dev.map-spike-mode')).toBe('empty 200, region alaska, line A');

    press('dev.map-spike-empty');
    expect(surface().styleUrl).toBe('http://localhost:8091/style-light.json?empty=404');
    press('dev.map-spike-empty');
    expect(surface().styleUrl).toBe('http://localhost:8091/style-light.json?empty=204');
    expect(mapFake.mountCount()).toBe(5);
  });

  it('reduced motion draws the surface with no transition', () => {
    renderWithProviders(<MapSpikeScreen apiOrigin="" spikeOrigin={null} />, {
      reducedMotion: true,
    });
    expect(layer('spike-cells-fill').paint['fill-opacity-transition']).toEqual({
      duration: 0,
      delay: 0,
    });
    expect(layer('spike-rings').paint['circle-stroke-opacity-transition']).toEqual({
      duration: 0,
      delay: 0,
    });
  });

  it('the line data swaps without a remount', () => {
    draw();
    press('dev.map-spike-geojson');
    expect(geoIds()).toEqual([11, 12, 13]);
    expect(surface().geojsonSources[0]?.id).toBe('spike-geo');
    expect(line('dev.map-spike-mode')).toBe('empty 204, region spike, line B');
    expect(mapFake.mountCount()).toBe(1);
    press('dev.map-spike-geojson');
    expect(geoIds()).toEqual([1, 2, 3]);
    expect(mapFake.mountCount()).toBe(1);
  });

  it('queries show their answer', async () => {
    draw();
    mapFake.scriptFeatures([
      {
        layerId: 'spike-hit',
        sourceId: 'spike',
        id: 5,
        properties: { n: 5, name: 'Cell 5' },
        point: [-79.4531, 36.0283],
        bounds: null,
      },
    ]);
    press('dev.map-spike-query-centre');
    expect(mapFake.calls.at(-1)).toEqual({
      op: 'queryRenderedFeatures',
      at: 'center',
      layerIds: ['spike-hit'],
      radius: 22,
    });
    expect(await screen.findByText('centre 1 features: 5')).toBe(
      screen.getByTestId('dev.map-spike-query'),
    );

    press('dev.map-spike-query-viewport');
    expect(mapFake.calls.at(-1)).toEqual({
      op: 'queryRenderedFeatures',
      at: 'viewport',
      layerIds: ['spike-cells-fill'],
      radius: null,
    });
    expect(await screen.findByText('viewport 1 cell features')).toBe(
      screen.getByTestId('dev.map-spike-query'),
    );
  });

  it('a query with several answers lists every id', async () => {
    draw();
    const hit = {
      layerId: 'spike-hit',
      sourceId: 'spike',
      properties: {},
      point: null,
      bounds: null,
    };
    mapFake.scriptFeatures([
      { ...hit, id: 5 },
      { ...hit, id: 6 },
    ]);
    press('dev.map-spike-query-centre');
    expect(await screen.findByText('centre 2 features: 5, 6')).toBeTruthy();

    mapFake.scriptFeatures([]);
    press('dev.map-spike-query-centre');
    expect(await screen.findByText('centre 0 features:')).toBeTruthy();
  });

  it('the marker is on the centre', () => {
    draw();
    expect(mapFake.markers()).toEqual([
      { testID: 'dev.map-spike-marker', coordinate: SPIKE_CENTRE, anchor: 'center' },
    ]);
    // Lifting it replays its spring and moves nothing else.
    press('dev.map-spike-lift');
    expect(mapFake.markers()).toEqual([
      { testID: 'dev.map-spike-marker', coordinate: SPIKE_CENTRE, anchor: 'center' },
    ]);
    expect(mapFake.mountCount()).toBe(1);
  });

  it('the theme control reloads the style', () => {
    draw();
    expect(screen.getByTestId('dev.map-spike-theme').getAttribute('aria-label')).toBe(
      'Theme: system',
    );
    press('dev.map-spike-theme');
    expect(screen.getByTestId('dev.map-spike-theme').getAttribute('aria-label')).toBe(
      'Theme: light',
    );
    expect(surface().styleUrl).toBe('http://localhost:8091/style-light.json?empty=204');
    press('dev.map-spike-theme');
    expect(screen.getByTestId('dev.map-spike-theme').getAttribute('aria-label')).toBe(
      'Theme: dark',
    );
    expect(surface().styleUrl).toBe('http://localhost:8091/style-dark.json?empty=204');
    expect(layer('spike-points').paint['circle-color']).toBe(color.dark.pinBg);
    expect(color.dark.pinBg).not.toBe(color.light.pinBg);
    expect(surface().webStyle?.cssVariables['--spike-attrib-bg']).toBe(color.dark.surface);
    // A new style, not a new map.
    expect(mapFake.mountCount()).toBe(1);
  });

  it('an override origin is used', () => {
    draw({ apiOrigin: 'http://192.168.1.5:8080', spikeOrigin: 'http://10.0.2.2:8091' });
    expect(surface().styleUrl).toBe('http://10.0.2.2:8091/style-light.json?empty=204');
    expect(surface().sources[0]?.tiles).toEqual([
      'http://10.0.2.2:8091/tiles/{z}/{x}/{y}.pbf?empty=204',
    ]);
    expect(line('dev.map-spike-origin')).toBe('server http://10.0.2.2:8091');
  });

  it("a phone's API origin gives the host on the same machine", () => {
    draw({ apiOrigin: 'http://192.168.1.5:8080' });
    expect(surface().styleUrl).toBe('http://192.168.1.5:8091/style-light.json?empty=204');
  });

  it('the attribution controls', () => {
    draw();
    press('dev.map-spike-attribution-position');
    press('dev.map-spike-attribution-compact');
    expect(surface().attributionPosition).toBe('top-left');
    expect(surface().attributionCompact).toBe(false);
    expect(mapFake.mountCount()).toBe(1);
    press('dev.map-spike-attribution-position');
    press('dev.map-spike-attribution-compact');
    expect(surface().attributionPosition).toBe('bottom-right');
    expect(surface().attributionCompact).toBe(true);
  });

  it('the first view is the whole tile where the map is wide, and the cells alone on a phone', () => {
    try {
      for (const [width, height] of [
        [820, 1180],
        [1440, 900],
      ] as const) {
        cleanup();
        setViewport(width, height);
        draw();
        expect(surface().initialBounds, String(width)).toEqual(SPIKE_BOUNDS);
        expect(surface().initialPadding, String(width)).toEqual({
          top: 16,
          right: 16,
          bottom: 16,
          left: 16,
        });
      }
      for (const [width, height] of [
        [360, 740],
        [430, 932],
      ] as const) {
        cleanup();
        setViewport(width, height);
        draw();
        expect(surface().initialBounds, String(width)).toEqual(SPIKE_CLOSE_BOUNDS);
        // Alaska keeps its own box at every width.
        press('dev.map-spike-region');
        expect(surface().initialBounds, String(width)).toEqual(ALASKA_FIT);
      }
    } finally {
      setViewport(390, 844);
    }
  });

  it('its own theme reaches the edges of a window wider than the screen', () => {
    try {
      // The shell holds the screen to 1280 and paints the margins in the app's theme.
      setViewport(1600, 900);
      draw();
      const ground = screen.getByTestId('dev.spike-ground');
      expect(ground.style.position).toBe('absolute');
      expect(ground.style.left).toBe('-160px');
      expect(ground.style.right).toBe('-160px');
      expect(ground.style.top).toBe('0px');
      expect(ground.style.bottom).toBe('0px');
      expect(ground.style.backgroundColor).toBe(written(color.light.bg));
      expect(window.getComputedStyle(ground).pointerEvents).toBe('none');
      // Under the screen, which is drawn after it.
      const page = screen.getByTestId('dev.map-spike');
      expect(ground.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The spike turns dark while the app stays light: the margins turn with it.
      press('dev.map-spike-theme');
      press('dev.map-spike-theme');
      expect(screen.getByTestId('dev.spike-ground').style.backgroundColor).toBe(
        written(color.dark.bg),
      );
      expect(color.dark.bg).not.toBe(color.light.bg);

      // A window the screen fills has no margin to cover.
      for (const [width, height] of [
        [1280, 900],
        [820, 1180],
        [390, 844],
      ] as const) {
        cleanup();
        setViewport(width, height);
        draw();
        expect(screen.queryByTestId('dev.spike-ground'), String(width)).toBeNull();
      }
    } finally {
      setViewport(390, 844);
    }
  });

  it('the panel stands beside the map from the medium width up', () => {
    try {
      setViewport(1440, 900);
      draw();
      expect(screen.getByTestId('dev.map-spike-panel').style.width).toBe('320px');
      expect(screen.getAllByRole('button')).toHaveLength(CONTROL_IDS.length);
      expect(mapFake.mountCount()).toBe(1);
    } finally {
      setViewport(390, 844);
    }
  });
});
