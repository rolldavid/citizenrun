import type { ComponentType, ReactNode, Ref } from 'react';

export type LngLat = readonly [lng: number, lat: number];
export type LngLatBounds = readonly [west: number, south: number, east: number, north: number];
export type ScreenPoint = { x: number; y: number }; // points from the surface's top-left corner
/** Screen points kept clear around a camera target: the sheet, the controls. */
export type MapPadding = { top: number; right: number; bottom: number; left: number };

/** A MapLibre expression as JSON (D-201). */
export type StyleExpression = readonly unknown[];
export type StyleTransition = { duration: number; delay: number };
export type StyleValue =
  | string
  | number
  | boolean
  | StyleExpression
  | StyleTransition
  | readonly number[]
  | readonly string[];

/** One data layer, built only by the map's layer module (MAP-layers, D-201), the same on both platforms. */
export type MapLayerSpec = {
  id: string;
  type: 'fill' | 'line' | 'circle' | 'symbol';
  source: string; // a source of the style, or of `geojsonSources`
  sourceLayer: string | null; // the MVT layer; null for a GeoJSON source
  before: string; // the style's anchor layer it is inserted directly before (the MapAnchorId values)
  minzoom: number | null;
  maxzoom: number | null;
  filter: StyleExpression | null;
  layout: Readonly<Record<string, StyleValue>>; // style-spec keys, kebab-case
  paint: Readonly<Record<string, StyleValue>>; // style-spec keys, kebab-case, including `*-transition`
  webOnly: boolean; // phones skip the layer (the hover layers)
};

/** One vector source, built from one MapMeta.sources entry as { id, tiles: [entry.tiles], minzoom, maxzoom }. */
export type MapVectorSource = {
  id: string;
  tiles: readonly string[];
  minzoom: number;
  maxzoom: number;
};

/** A GeoJSON source the client fills (the `cr-overlay` source). */
export type MapGeoJsonGeometry =
  | { type: 'Point'; coordinates: LngLat }
  | { type: 'LineString'; coordinates: readonly LngLat[] }
  | { type: 'MultiLineString'; coordinates: readonly (readonly LngLat[])[] };
export type MapGeoJsonFeature = {
  type: 'Feature';
  id: number | null; // omitted from what the library receives when null
  geometry: MapGeoJsonGeometry;
  properties: Readonly<Record<string, string | number | boolean | null>>;
};
export type MapFeatureCollection = {
  type: 'FeatureCollection';
  features: readonly MapGeoJsonFeature[];
};
export type MapGeoJsonSource = { id: string; data: MapFeatureCollection };

export type MapErrorCode = 'map.webgl_unavailable' | 'map.style_failed' | 'map.load_failed';

export type MapStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; styleErrors: number } // styleErrors: error events since the style loaded (0 on phones, which report none)
  | { kind: 'error'; code: MapErrorCode };

/** A rendered feature. `id` is the tile feature id (districts.tile_id, the cluster id, D-052, D-205) or null. */
export type MapFeature = {
  layerId: string;
  sourceId: string;
  id: number | null;
  properties: Readonly<Record<string, string | number | boolean | null>>;
  /** The feature's own coordinates when its geometry is a point; null otherwise. */
  point: LngLat | null;
  /** The bounds of this rendered piece's geometry when it is not a point; null for a point or no geometry. */
  bounds: LngLatBounds | null;
};
export type MapHit = { point: ScreenPoint; lngLat: LngLat; features: readonly MapFeature[] };
export type MapCamera = { center: LngLat; zoom: number; bounds: LngLatBounds };
export type FeatureTarget = { sourceId: string; sourceLayer: string; id: number };

export type MapSurfaceProps = {
  // PM-map-spike
  /** MapMeta.styles.light or .dark (E-TILE-05). A new value reloads the style. */
  styleUrl: string;
  sources: readonly MapVectorSource[];
  /** Replaced when `data` changes. */
  geojsonSources: readonly MapGeoJsonSource[];
  /** In draw order, bottom first, within each anchor; ids unique. */
  layers: readonly MapLayerSpec[];
  initialBounds: LngLatBounds;
  initialPadding: MapPadding;
  /** The region's `max` box (MAP-regions); a new value is applied at once. */
  maxBounds: LngLatBounds | null;
  minZoom: number; // 3 (D-201), passed by the caller
  maxZoom: number; // 16 (D-201), passed by the caller
  attributionPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Web: the attribution control starts collapsed. Phones ignore it. */
  attributionCompact: boolean;
  /** Web only; never called on phones. Called when the map canvas gains or loses focus. `keyboard` is true when
   *  the focus came from the keyboard: canvas.matches(':focus-visible') at the focus event. */
  onFocusChange?: (focus: { focused: boolean; keyboard: boolean }) => void;
  /** Web: CSS for the library's controls, injected once per page, and the CSS custom properties set on the map's
   *  container (`MAP_WEB_CSS` and `mapWebCssVariables(...)`). null adds nothing.
   *  Phones ignore it. */
  webStyle: { css: string; cssVariables: Readonly<Record<string, string>> } | null;
  onStatus(status: MapStatus): void;
  handleRef: Ref<MapHandle>;
  accessibilityLabel: string;
  testID: string;
  /** Marker elements only. */
  children?: ReactNode;
};

export interface MapHandle {
  // PM-map-spike
  setFeatureState(target: FeatureTarget, state: Readonly<Record<string, boolean | number>>): void;
  removeFeatureState(target: FeatureTarget, key?: string): void;
  /** Rendered features of these layers, topmost first (list `layerIds` topmost first): at a point or the
   *  centre (within `radius` points, default 0), or anywhere in the visible area ('viewport'; `radius` is then
   *  ignored). */
  queryRenderedFeatures(
    at: ScreenPoint | 'center' | 'viewport',
    layerIds: readonly string[],
    radius?: number,
  ): Promise<readonly MapFeature[]>;
}

export type MapMarkerProps = {
  coordinate: LngLat;
  anchor: 'center' | 'bottom';
  /** The marker's own view; its look and motion are the caller's (D-203: the selected pin lifts). */
  children: ReactNode;
  testID: string;
};

export interface MapModule {
  // PM-map-spike
  Surface: ComponentType<MapSurfaceProps>;
  Marker: ComponentType<MapMarkerProps>;
}
