import {
  Camera,
  GeoJSONSource,
  Layer,
  LogManager,
  Map as MapView,
  Marker as MapMarker,
  VectorSource,
} from '@maplibre/maplibre-react-native';
import type {
  GeoJSONSourceProps,
  LayerProps,
  MapProps,
  MapRef,
  VectorSourceRef,
} from '@maplibre/maplibre-react-native';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { forPhones, pinTransitions, withPinnedTransitions } from './layer-diff';
import type { PinnedTransitions } from './layer-diff';
import { centrePoint, featureFacts, queryArea } from './query-geometry';
import type {
  MapFeature,
  MapFeatureCollection,
  MapHandle,
  MapLayerSpec,
  MapMarkerProps,
  MapModule,
  MapStatus,
  MapSurfaceProps,
  ScreenPoint,
} from './types';

// PM-map-spike on phones: MapLibre React Native (D-200).

/**
 * Appended to each vector source's id on phones. '' attaches the source component to the style's source of the
 * same id; '.n' is the fallback that declares a separate copy, which every layer then reads (PM-map-spike).
 */
const NATIVE_SOURCE_SUFFIX: '' | '.n' = '';

const NO_PINS: PinnedTransitions = new Map();

/** Library messages never reach a log (PM-map-spike). */
function dropLibraryLog(): boolean {
  return true;
}

type OrnamentPosition = NonNullable<MapProps['attributionPosition']>;

function ornamentPosition(corner: MapSurfaceProps['attributionPosition']): OrnamentPosition {
  switch (corner) {
    case 'top-left':
      return { top: 0, left: 0 };
    case 'top-right':
      return { top: 0, right: 0 };
    case 'bottom-left':
      return { bottom: 0, left: 0 };
    case 'bottom-right':
      return { bottom: 0, right: 0 };
  }
}

function geoJsonData(collection: MapFeatureCollection): GeoJSONSourceProps['data'] {
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

/** The layer component of one spec; a change of type or source layer mounts a new one (PM-map-spike). */
function renderLayer(spec: MapLayerSpec, pinned: PinnedTransitions, source?: string): JSX.Element {
  const layer = withPinnedTransitions(spec, pinned);
  // The spec's layout and paint are style-spec JSON, which the component takes as they are.
  const props = {
    id: layer.id,
    type: layer.type,
    ...(source === undefined ? {} : { source }),
    ...(layer.sourceLayer === null ? {} : { 'source-layer': layer.sourceLayer }),
    ...(layer.filter === null ? {} : { filter: layer.filter }),
    ...(layer.minzoom === null ? {} : { minzoom: layer.minzoom }),
    ...(layer.maxzoom === null ? {} : { maxzoom: layer.maxzoom }),
    layout: layer.layout,
    paint: layer.paint,
    beforeId: layer.before,
  } as unknown as LayerProps;
  return <Layer key={`${layer.id}|${layer.type}|${layer.sourceLayer ?? ''}`} {...props} />;
}

/** A numeric feature id, which the phone libraries may hand back as its decimal text. */
function numericId(id: unknown): number | null {
  if (typeof id === 'number') return Number.isFinite(id) ? id : null;
  if (typeof id === 'string' && /^-?\d+$/.test(id)) {
    const value = Number(id);
    return Number.isSafeInteger(value) ? value : null;
  }
  return null;
}

function toFeature(feature: GeoJSON.Feature, spec: MapLayerSpec): MapFeature {
  const properties: Record<string, string | number | boolean | null> = {};
  const given: Readonly<Record<string, unknown>> = feature.properties ?? {};
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
  return {
    layerId: spec.id,
    sourceId: spec.source,
    id: numericId(feature.id),
    properties,
    ...featureFacts(feature.geometry),
  };
}

function asPixel(point: ScreenPoint): [number, number] {
  return [point.x, point.y];
}

type Live = {
  onStatus: (status: MapStatus) => void;
  layers: readonly MapLayerSpec[];
  size: { width: number; height: number };
  styleLoaded: boolean;
  styleUrl: string;
};

function Surface(props: MapSurfaceProps): JSX.Element {
  const {
    styleUrl,
    sources,
    geojsonSources,
    layers,
    initialBounds,
    initialPadding,
    maxBounds,
    minZoom,
    maxZoom,
    attributionPosition,
    handleRef,
    accessibilityLabel,
    testID,
    children,
  } = props;
  const onStatus = props.onStatus.bind(props);
  const mapRef = useRef<MapRef | null>(null);
  const [sourceRefs] = useState(() => new Map<string, VectorSourceRef>());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const live = useRef<Live>({ onStatus, layers, size, styleLoaded: false, styleUrl });

  useEffect(() => {
    live.current.onStatus = onStatus;
    live.current.layers = layers;
    live.current.size = size;
  });

  // A transition is read from its layer's first appearance only (PM-map-spike). Kept as state adjusted
  // during render, so the first render of a new layer already carries its pinned values.
  const [pinned, setPinned] = useState<PinnedTransitions>(NO_PINS);
  const nextPinned = pinTransitions(pinned, layers);
  if (nextPinned !== pinned) setPinned(nextPinned);

  useEffect(() => {
    LogManager.onLog(dropLibraryLog);
    live.current.onStatus({ kind: 'loading' });
  }, []);

  // A new style reloads; the style-loaded event reports `ready` again (PM-map-spike).
  useEffect(() => {
    if (live.current.styleUrl === styleUrl) return;
    live.current.styleUrl = styleUrl;
    live.current.styleLoaded = false;
    live.current.onStatus({ kind: 'loading' });
  }, [styleUrl]);

  useImperativeHandle(
    handleRef,
    (): MapHandle => ({
      setFeatureState(target, state) {
        const source = sourceRefs.get(target.sourceId);
        if (source === undefined) return;
        source
          .setFeatureState({ id: target.id, sourceLayer: target.sourceLayer }, { ...state })
          .catch(() => undefined);
      },
      removeFeatureState(target, key) {
        const source = sourceRefs.get(target.sourceId);
        if (source === undefined) return;
        source
          .removeFeatureState({ id: target.id, sourceLayer: target.sourceLayer }, key)
          .catch(() => undefined);
      },
      async queryRenderedFeatures(at, layerIds, radius = 0) {
        const view = mapRef.current;
        if (view === null) return [];
        const { width, height } = live.current.size;
        const specs = new Map(forPhones(live.current.layers).map((spec) => [spec.id, spec]));
        const found: MapFeature[] = [];
        try {
          for (const layerId of layerIds) {
            const spec = specs.get(layerId);
            if (spec === undefined) continue;
            const options = { layers: [layerId] };
            let features: GeoJSON.Feature[];
            if (at === 'viewport') {
              features = await view.queryRenderedFeatures(
                [
                  [0, 0],
                  [width, height],
                ],
                options,
              );
            } else {
              const area = queryArea(at === 'center' ? centrePoint({ width, height }) : at, radius);
              features =
                'x' in area
                  ? await view.queryRenderedFeatures(asPixel(area), options)
                  : await view.queryRenderedFeatures([asPixel(area[0]), asPixel(area[1])], options);
            }
            for (const feature of features) found.push(toFeature(feature, spec));
          }
        } catch {
          return [];
        }
        return found;
      },
    }),
    [sourceRefs],
  );

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  const onStyleLoaded = (): void => {
    live.current.styleLoaded = true;
    live.current.onStatus({ kind: 'ready', styleErrors: 0 });
  };

  const onLoadFailed = (): void => {
    live.current.onStatus({
      kind: 'error',
      code: live.current.styleLoaded ? 'map.load_failed' : 'map.style_failed',
    });
  };

  const phoneLayers = forPhones(layers);
  const declared = new Set([
    ...sources.map((source) => source.id),
    ...geojsonSources.map((source) => source.id),
  ]);
  const registerSource = (id: string) => (source: VectorSourceRef | null) => {
    if (source === null) return;
    sourceRefs.set(id, source);
    return () => {
      if (sourceRefs.get(id) === source) sourceRefs.delete(id);
    };
  };

  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={styles.root}
      onLayout={onLayout}
    >
      <MapView
        mapStyle={styleUrl}
        touchRotate={false}
        touchPitch={false}
        attribution
        attributionPosition={ornamentPosition(attributionPosition)}
        logo={false}
        compass={false}
        onDidFinishLoadingStyle={onStyleLoaded}
        onDidFailLoadingMap={onLoadFailed}
        ref={mapRef}
      >
        <Camera
          initialViewState={{ bounds: [...initialBounds], padding: initialPadding }}
          {...(maxBounds === null ? {} : { maxBounds: [...maxBounds] })}
          minZoom={minZoom}
          maxZoom={maxZoom}
        />
        {sources.map((source) => (
          <VectorSource
            key={source.id}
            id={source.id + NATIVE_SOURCE_SUFFIX}
            tiles={[...source.tiles]}
            minzoom={source.minzoom}
            maxzoom={source.maxzoom}
            ref={registerSource(source.id)}
          >
            {phoneLayers
              .filter((spec) => spec.source === source.id)
              .map((spec) => renderLayer(spec, nextPinned))}
          </VectorSource>
        ))}
        {geojsonSources.map((source) => (
          <GeoJSONSource key={source.id} id={source.id} data={geoJsonData(source.data)}>
            {phoneLayers
              .filter((spec) => spec.source === source.id)
              .map((spec) => renderLayer(spec, nextPinned))}
          </GeoJSONSource>
        ))}
        {phoneLayers
          .filter((spec) => !declared.has(spec.source))
          .map((spec) => renderLayer(spec, nextPinned, spec.source))}
        {children}
      </MapView>
    </View>
  );
}

function Marker({ coordinate, anchor, children, testID }: MapMarkerProps): JSX.Element {
  return (
    <MapMarker lngLat={[coordinate[0], coordinate[1]]} anchor={anchor}>
      <View testID={testID}>{children}</View>
    </MapMarker>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});

export const map: MapModule = { Surface, Marker };

export type * from './types';
