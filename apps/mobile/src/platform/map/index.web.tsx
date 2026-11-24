import { createContext, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ComponentRef, JSX } from 'react';
import { createPortal } from 'react-dom';
import { StyleSheet, View } from 'react-native';
import type * as MapLibre from 'maplibre-gl';

import { diffLayers, toStyleLayer } from './layer-diff';
import type { LayerOp } from './layer-diff';
import { centrePoint, featureFacts, queryArea } from './query-geometry';
import type {
  MapFeature,
  MapFeatureCollection,
  MapGeoJsonSource,
  MapHandle,
  MapLayerSpec,
  MapMarkerProps,
  MapModule,
  MapStatus,
  MapSurfaceProps,
  ScreenPoint,
} from './types';

// PM-map-spike on the web: MapLibre GL JS, loaded by a dynamic import when the first map mounts (D-182, D-200).

type Gl = typeof MapLibre;
type GlMap = MapLibre.Map;
// The spec's keys and values are style-spec JSON, which the library types as unions.
type PaintKey = Parameters<GlMap['setPaintProperty']>[1];
type PaintValue = Parameters<GlMap['setPaintProperty']>[2];
type LayoutKey = Parameters<GlMap['setLayoutProperty']>[1];
type LayoutValue = Parameters<GlMap['setLayoutProperty']>[2];
type Attribution = { control: MapLibre.AttributionControl; compact: boolean; position: string };
/** A created map and the library that made it. */
type Attached = { map: GlMap; gl: Gl };

/** True when the browser gives a WebGL2 context; the probe's context is released at once (D-200). */
function hasWebGl2(): boolean {
  try {
    const context = document.createElement('canvas').getContext('webgl2');
    if (context === null) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

let pagePromise: Promise<Gl> | null = null;

function addStylesheet(version: string): Promise<void> {
  if (document.head.querySelector(`link[data-maplibre-css="${version}"]`) !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/maplibre-gl-${version}.css`;
    link.dataset.maplibreCss = version;
    link.addEventListener(
      'load',
      () => {
        resolve();
      },
      { once: true },
    );
    link.addEventListener(
      'error',
      () => {
        link.remove();
        reject(new Error('map.load_failed'));
      },
      { once: true },
    );
    document.head.append(link);
  });
}

async function loadPage(): Promise<Gl> {
  const gl = await import('maplibre-gl');
  const version = gl.getVersion();
  gl.setWorkerUrl(`/maplibre-gl-worker-${version}.mjs`);
  await addStylesheet(version);
  return gl;
}

/** Once per page: the library, its worker URL before any map exists, and its stylesheet. */
function preparePage(): Promise<Gl> {
  if (pagePromise === null) {
    const attempt = loadPage();
    pagePromise = attempt;
    attempt.catch(() => {
      if (pagePromise === attempt) pagePromise = null;
    });
  }
  return pagePromise;
}

const adoptedCss = new Set<string>();

/** The caller's control CSS, added once per page through the CSS object model (D-446). */
function adoptCss(css: string): void {
  if (adoptedCss.has(css)) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  adoptedCss.add(css);
}

function geoJsonData(collection: MapFeatureCollection): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => ({
      type: 'Feature',
      ...(feature.id === null ? {} : { id: feature.id }),
      // The library's GeoJSON types are mutable; the value is only read.
      geometry: feature.geometry as unknown as GeoJSON.Geometry,
      properties: { ...feature.properties },
    })),
  };
}

function applyOp(map: GlMap, op: LayerOp): void {
  switch (op.op) {
    case 'remove':
      map.removeLayer(op.id);
      return;
    case 'paint':
      map.setPaintProperty(op.id, op.key as PaintKey, (op.value ?? undefined) as PaintValue);
      return;
    case 'layout':
      map.setLayoutProperty(op.id, op.key as LayoutKey, (op.value ?? undefined) as LayoutValue);
      return;
    case 'filter':
      map.setFilter(op.id, (op.filter ?? null) as MapLibre.FilterSpecification | null);
      return;
    case 'zoom':
      map.setLayerZoomRange(op.id, op.minzoom ?? 0, op.maxzoom ?? 24);
      return;
    case 'add':
      map.addLayer(toStyleLayer(op.spec) as unknown as MapLibre.AddLayerObject, op.before);
      return;
    case 'move':
      map.moveLayer(op.id, op.before);
      return;
  }
}

function toFeature(feature: MapLibre.MapGeoJSONFeature): MapFeature {
  const properties: Record<string, string | number | boolean | null> = {};
  const given: Readonly<Record<string, unknown>> = feature.properties;
  for (const [key, value] of Object.entries(given)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      properties[key] = value;
    }
  }
  const id = typeof feature.id === 'number' && Number.isFinite(feature.id) ? feature.id : null;
  return {
    layerId: feature.layer.id,
    sourceId: feature.source,
    id,
    properties,
    ...featureFacts(feature.geometry),
  };
}

function asPoint(point: ScreenPoint): [number, number] {
  return [point.x, point.y];
}

const SurfaceContext = createContext<Attached | null>(null);

/** What the surface tracks between the library's events and React's renders. */
type Track = {
  surface: Attached | null;
  container: HTMLElement | null;
  ready: boolean;
  /** Errors reported as a failed load; the load step reports `ready` only when none arrives during it. */
  failedLoads: number;
  styleErrors: number;
  styleUrl: string;
  applied: readonly MapLayerSpec[];
  geojson: Map<string, string>;
  attribution: Attribution | null;
  webStyleKey: string | null;
};

function Surface(props: MapSurfaceProps): JSX.Element {
  const {
    styleUrl,
    layers,
    geojsonSources,
    maxBounds,
    minZoom,
    maxZoom,
    attributionCompact,
    attributionPosition,
    webStyle,
    accessibilityLabel,
    handleRef,
    testID,
    children,
  } = props;
  const containerRef = useRef<ComponentRef<typeof View>>(null);
  const latest = useRef(props);
  const track = useRef<Track>({
    surface: null,
    container: null,
    ready: false,
    failedLoads: 0,
    styleErrors: 0,
    styleUrl,
    applied: [],
    geojson: new Map(),
    attribution: null,
    webStyleKey: null,
  });
  const [surface, setSurface] = useState<Attached | null>(null);
  // Counts the caller's sources and layers being added on `style.load`; the change effects run again after it.
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    let cancelled = false;
    let created: GlMap | null = null;
    const t = track.current;
    const report = (status: MapStatus): void => {
      if (!cancelled) latest.current.onStatus(status);
    };

    /** A failure: before the caller's layers are on the map it is a failed load; after, one more style error. */
    const fail = (code: 'map.style_failed' | 'map.load_failed'): void => {
      if (!t.ready) {
        t.failedLoads += 1;
        report({ kind: 'error', code });
        return;
      }
      t.styleErrors += 1;
      report({ kind: 'ready', styleErrors: t.styleErrors });
    };

    const run = async (): Promise<void> => {
      report({ kind: 'loading' });
      if (!hasWebGl2()) {
        report({ kind: 'error', code: 'map.webgl_unavailable' });
        return;
      }
      let gl: Gl;
      try {
        gl = await preparePage();
      } catch {
        report({ kind: 'error', code: 'map.load_failed' });
        return;
      }
      // react-native-web gives the host DOM node as the View's ref.
      const container = containerRef.current as unknown as HTMLElement | null;
      if (cancelled || container === null) return;

      const p = latest.current;
      let map: GlMap;
      try {
        map = new gl.Map({
          container,
          style: p.styleUrl,
          bounds: [...p.initialBounds] as [number, number, number, number],
          fitBoundsOptions: { padding: p.initialPadding },
          ...(p.maxBounds === null
            ? {}
            : { maxBounds: [...p.maxBounds] as [number, number, number, number] }),
          minZoom: p.minZoom,
          maxZoom: p.maxZoom,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: false,
          keyboard: true,
        });
      } catch (error) {
        report({
          kind: 'error',
          code:
            error instanceof gl.GPUInitializationError
              ? 'map.webgl_unavailable'
              : 'map.load_failed',
        });
        return;
      }
      created = map;
      t.container = container;
      t.styleUrl = p.styleUrl;
      t.ready = false;
      t.applied = [];
      t.geojson = new Map();

      try {
        map.touchZoomRotate.disableRotation();
        const control = new gl.AttributionControl({ compact: p.attributionCompact });
        map.addControl(control, p.attributionPosition);
        t.attribution = {
          control,
          compact: p.attributionCompact,
          position: p.attributionPosition,
        };
      } catch {
        report({ kind: 'error', code: 'map.load_failed' });
        return;
      }

      const canvas = map.getCanvas();
      canvas.addEventListener('focus', () => {
        latest.current.onFocusChange?.({
          focused: true,
          keyboard: canvas.matches(':focus-visible'),
        });
      });
      canvas.addEventListener('blur', () => {
        latest.current.onFocusChange?.({ focused: false, keyboard: false });
      });

      map.on('error', (event: MapLibre.ErrorEvent) => {
        const url = (event.error as { url?: unknown } | undefined)?.url;
        fail(url === t.styleUrl ? 'map.style_failed' : 'map.load_failed');
      });

      map.on('style.load', () => {
        const current = latest.current;
        // The library reports some failures of the steps below as `error` events, not as throws.
        t.ready = false;
        const failedBefore = t.failedLoads;
        try {
          for (const source of current.sources) {
            if (map.getSource(source.id) === undefined) {
              map.addSource(source.id, {
                type: 'vector',
                tiles: [...source.tiles],
                minzoom: source.minzoom,
                maxzoom: source.maxzoom,
              });
            }
          }
          t.geojson = new Map();
          for (const source of current.geojsonSources) {
            addGeoJson(map, source);
            t.geojson.set(source.id, JSON.stringify(source.data));
          }
          for (const op of diffLayers([], current.layers)) applyOp(map, op);
        } catch {
          fail('map.load_failed');
          return;
        }
        // An error event during the step is a failed load, never a `ready` over it (PM-map-spike).
        if (t.failedLoads !== failedBefore) return;
        t.applied = current.layers;
        t.ready = true;
        t.styleErrors = 0;
        report({ kind: 'ready', styleErrors: 0 });
        if (!cancelled) setLoads((n) => n + 1);
      });

      t.surface = { map, gl };
      setSurface(t.surface);
    };

    void run();

    return () => {
      cancelled = true;
      created?.remove();
      t.surface = null;
      t.container = null;
      t.ready = false;
      t.attribution = null;
      t.webStyleKey = null;
    };
  }, []);

  // A new style reloads everything; feature state is cleared and the caller re-applies it on `ready`
  // (PM-map-spike).
  useEffect(() => {
    const t = track.current;
    if (surface === null || t.styleUrl === styleUrl) return;
    t.styleUrl = styleUrl;
    t.ready = false;
    t.applied = [];
    latest.current.onStatus({ kind: 'loading' });
    try {
      // A diffed style swap fires no `style.load` and drops the caller's layers.
      surface.map.setStyle(styleUrl, { diff: false });
    } catch {
      latest.current.onStatus({ kind: 'error', code: 'map.style_failed' });
    }
  }, [surface, styleUrl]);

  useEffect(() => {
    const t = track.current;
    if (surface === null || !t.ready) return;
    const ops = diffLayers(t.applied, layers);
    t.applied = layers;
    for (const op of ops) {
      try {
        applyOp(surface.map, op);
      } catch {
        t.styleErrors += 1;
        latest.current.onStatus({ kind: 'ready', styleErrors: t.styleErrors });
      }
    }
  }, [surface, loads, layers]);

  useEffect(() => {
    const t = track.current;
    if (surface === null || !t.ready) return;
    for (const source of geojsonSources) {
      const text = JSON.stringify(source.data);
      if (t.geojson.get(source.id) === text && surface.map.getSource(source.id) !== undefined) {
        continue;
      }
      try {
        addGeoJson(surface.map, source);
        t.geojson.set(source.id, text);
      } catch {
        t.styleErrors += 1;
        latest.current.onStatus({ kind: 'ready', styleErrors: t.styleErrors });
      }
    }
  }, [surface, loads, geojsonSources]);

  const [west, south, east, north] = maxBounds ?? [];
  useEffect(() => {
    if (surface === null) return;
    const bounds: [number, number, number, number] | null =
      west === undefined || south === undefined || east === undefined || north === undefined
        ? null
        : [west, south, east, north];
    try {
      surface.map.setMaxBounds(bounds);
      surface.map.setMinZoom(minZoom);
      surface.map.setMaxZoom(maxZoom);
    } catch {
      // Library errors stay inside the module (PM-map-spike).
    }
  }, [surface, west, south, east, north, minZoom, maxZoom]);

  // The library has no setter for either value, so the control is replaced and exactly one exists (D-544).
  useEffect(() => {
    const t = track.current;
    const current = t.attribution;
    if (surface === null || current === null) return;
    if (current.compact === attributionCompact && current.position === attributionPosition) return;
    try {
      surface.map.removeControl(current.control);
      const control = new surface.gl.AttributionControl({ compact: attributionCompact });
      surface.map.addControl(control, attributionPosition);
      t.attribution = { control, compact: attributionCompact, position: attributionPosition };
    } catch {
      t.attribution = null;
    }
  }, [surface, attributionCompact, attributionPosition]);

  const webCss = webStyle?.css ?? null;
  const webVariables = webStyle === null ? null : JSON.stringify(webStyle.cssVariables);
  useEffect(() => {
    const t = track.current;
    const container = t.container;
    if (surface === null || container === null || webCss === null || webVariables === null) return;
    const key = `${webCss}\n${webVariables}`;
    if (t.webStyleKey === key) return;
    t.webStyleKey = key;
    adoptCss(webCss);
    const variables = JSON.parse(webVariables) as Record<string, string>;
    for (const [name, value] of Object.entries(variables)) {
      container.style.setProperty(name, value);
    }
  }, [surface, webCss, webVariables]);

  useEffect(() => {
    if (surface === null) return;
    surface.map.getCanvas().setAttribute('aria-label', accessibilityLabel);
  }, [surface, accessibilityLabel]);

  useImperativeHandle(
    handleRef,
    (): MapHandle => ({
      setFeatureState(target, state) {
        const t = track.current;
        if (t.surface === null || !t.ready) return;
        try {
          t.surface.map.setFeatureState(
            { source: target.sourceId, sourceLayer: target.sourceLayer, id: target.id },
            state,
          );
        } catch {
          // Library errors stay inside the module (PM-map-spike).
        }
      },
      removeFeatureState(target, key) {
        const t = track.current;
        if (t.surface === null || !t.ready) return;
        try {
          t.surface.map.removeFeatureState(
            { source: target.sourceId, sourceLayer: target.sourceLayer, id: target.id },
            key,
          );
        } catch {
          // Library errors stay inside the module (PM-map-spike).
        }
      },
      queryRenderedFeatures(at, layerIds, radius = 0) {
        const t = track.current;
        if (t.surface === null || !t.ready) return Promise.resolve([]);
        const { map } = t.surface;
        try {
          const known = layerIds.filter((id) => map.getLayer(id) !== undefined);
          if (known.length === 0) return Promise.resolve([]);
          const options = { layers: known };
          let found: MapLibre.MapGeoJSONFeature[];
          if (at === 'viewport') {
            found = map.queryRenderedFeatures(options);
          } else {
            const container = t.container;
            const point =
              at === 'center'
                ? centrePoint({
                    width: container?.clientWidth ?? 0,
                    height: container?.clientHeight ?? 0,
                  })
                : at;
            const area = queryArea(point, radius);
            found =
              'x' in area
                ? map.queryRenderedFeatures(asPoint(area), options)
                : map.queryRenderedFeatures([asPoint(area[0]), asPoint(area[1])], options);
          }
          return Promise.resolve(found.map(toFeature));
        } catch {
          return Promise.resolve([]);
        }
      },
    }),
    [],
  );

  return (
    <View testID={testID} style={styles.root}>
      {/* The library's stylesheet makes its container `position: relative`, so it fills by flex. */}
      <View ref={containerRef} style={styles.root} />
      <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>
    </View>
  );
}

function addGeoJson(map: GlMap, source: MapGeoJsonSource): void {
  const data = geoJsonData(source.data);
  const existing = map.getSource(source.id);
  if (existing === undefined) {
    map.addSource(source.id, { type: 'geojson', data });
    return;
  }
  // A failed update stays inside the module; the map keeps the last data (PM-map-spike).
  void Promise.resolve((existing as MapLibre.GeoJSONSource).setData(data)).catch(() => undefined);
}

function Marker({ coordinate, anchor, children, testID }: MapMarkerProps): JSX.Element {
  const surface = useContext(SurfaceContext);
  const [element] = useState(() => document.createElement('div'));
  const marker = useRef<MapLibre.Marker | null>(null);
  const [lng, lat] = coordinate;
  const position = useRef<[number, number]>([lng, lat]);

  useEffect(() => {
    position.current = [lng, lat];
    marker.current?.setLngLat([lng, lat]);
  }, [lng, lat]);

  useEffect(() => {
    if (surface === null) return;
    const placed = new surface.gl.Marker({ element, anchor })
      .setLngLat(position.current)
      .addTo(surface.map);
    marker.current = placed;
    return () => {
      placed.remove();
      marker.current = null;
    };
  }, [surface, element, anchor]);

  return createPortal(<View testID={testID}>{children}</View>, element);
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export const map: MapModule = { Surface, Marker };

export type * from './types';
