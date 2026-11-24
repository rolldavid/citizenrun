import { useEffect, useImperativeHandle, useState } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import type {
  FeatureTarget,
  LngLat,
  LngLatBounds,
  MapFeature,
  MapFeatureCollection,
  MapHandle,
  MapMarkerProps,
  MapModule,
  MapStatus,
  MapSurfaceProps,
  ScreenPoint,
} from '@/platform/map/types';

/** Every call made through the surface's handle, with its arguments. */
export type MapFakeCall =
  | {
      op: 'setFeatureState';
      target: FeatureTarget;
      state: Readonly<Record<string, boolean | number>>;
    }
  | { op: 'removeFeatureState'; target: FeatureTarget; key: string | null }
  | {
      op: 'queryRenderedFeatures';
      at: ScreenPoint | 'center' | 'viewport';
      layerIds: readonly string[];
      radius: number | null;
    };

/** What the last rendered surface was given. */
export type MapFakeProps = {
  styleUrl: string;
  layerIds: readonly string[];
  sourceIds: readonly string[];
  /** The GeoJSON data per source id. */
  geojson: Readonly<Record<string, MapFeatureCollection>>;
  maxBounds: LngLatBounds | null;
  attributionCompact: boolean;
};

/** Every prop of a rendered surface except its callbacks, handleRef and children. */
export type MapFakeSurfaceProps = Omit<
  MapSurfaceProps,
  'onStatus' | 'onFocusChange' | 'handleRef' | 'children'
>;

/** A mounted marker as its props last described it. */
export type MapFakeMarker = { testID: string; coordinate: LngLat; anchor: 'center' | 'bottom' };

const calls: MapFakeCall[] = [];
/** The mounted markers' keys in mount order, and what each last rendered. */
const markerOrder: symbol[] = [];
const markerData = new Map<symbol, MapFakeMarker>();
const state: {
  features: readonly MapFeature[];
  lastProps: MapFakeProps | null;
  lastSurfaceProps: MapFakeSurfaceProps | null;
  mounted: MapSurfaceProps | null;
  mounts: number;
} = { features: [], lastProps: null, lastSurfaceProps: null, mounted: null, mounts: 0 };

const handle: MapHandle = {
  setFeatureState: (target, featureState) => {
    calls.push({ op: 'setFeatureState', target, state: featureState });
  },
  removeFeatureState: (target, key) => {
    calls.push({ op: 'removeFeatureState', target, key: key ?? null });
  },
  queryRenderedFeatures: (at, layerIds, radius) => {
    calls.push({
      op: 'queryRenderedFeatures',
      at,
      layerIds: [...layerIds],
      radius: radius ?? null,
    });
    return Promise.resolve(state.features);
  },
};

function describeProps(props: MapSurfaceProps): MapFakeProps {
  return {
    styleUrl: props.styleUrl,
    layerIds: props.layers.map((layer) => layer.id),
    sourceIds: props.sources.map((source) => source.id),
    geojson: Object.fromEntries(props.geojsonSources.map((source) => [source.id, source.data])),
    maxBounds: props.maxBounds,
    attributionCompact: props.attributionCompact,
  };
}

const CALLBACK_PROPS: ReadonlySet<string> = new Set([
  'onStatus',
  'onFocusChange',
  'handleRef',
  'children',
]);

function surfacePropsOf(props: MapSurfaceProps): MapFakeSurfaceProps {
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !CALLBACK_PROPS.has(key)),
  ) as MapFakeSurfaceProps;
}

function Surface(props: MapSurfaceProps): ReactElement {
  useImperativeHandle(props.handleRef, () => handle, []);
  useEffect(() => {
    state.mounts += 1;
  }, []);
  // Registered in an effect with a cleanup, so an unmounted surface is never called.
  useEffect(() => {
    state.lastProps = describeProps(props);
    state.lastSurfaceProps = surfacePropsOf(props);
    state.mounted = props;
    return () => {
      if (state.mounted === props) {
        state.mounted = null;
      }
    };
  });
  return <View testID={props.testID}>{props.children}</View>;
}

function Marker({ children, testID, coordinate, anchor }: MapMarkerProps): ReactElement {
  const [key] = useState(() => Symbol('marker'));
  useEffect(() => {
    markerData.set(key, { testID, coordinate, anchor });
  });
  useEffect(() => {
    markerOrder.push(key);
    return () => {
      const index = markerOrder.indexOf(key);
      if (index !== -1) markerOrder.splice(index, 1);
      markerData.delete(key);
    };
  }, [key]);
  return <View testID={testID}>{children}</View>;
}

export const map: MapModule = { Surface, Marker };

export const mapFake = {
  calls: calls as readonly MapFakeCall[],
  lastProps: (): MapFakeProps | null => state.lastProps,
  /** Every prop of the last rendered Surface except its callbacks, handleRef and children; null before any. */
  lastSurfaceProps: (): MapFakeSurfaceProps | null => state.lastSurfaceProps,
  /** How many times a Surface has mounted since the last reset (a remount by key counts). */
  mountCount: (): number => state.mounts,
  /** The mounted markers, in mount order. */
  markers: (): readonly MapFakeMarker[] =>
    markerOrder.flatMap((key) => {
      const marker = markerData.get(key);
      return marker === undefined ? [] : [{ ...marker }];
    }),
  /** Calls the mounted surface's onStatus; nothing when no surface is mounted. */
  emitStatus: (status: MapStatus): void => {
    state.mounted?.onStatus(status);
  },
  /** Calls the mounted surface's onFocusChange; nothing when no surface is mounted. */
  emitFocus: (focus: { focused: boolean; keyboard: boolean }): void => {
    state.mounted?.onFocusChange?.(focus);
  },
  /** The answer of every queryRenderedFeatures call. */
  scriptFeatures: (features: readonly MapFeature[]): void => {
    state.features = features;
  },
  reset: (): void => {
    calls.length = 0;
    state.features = [];
    state.lastProps = null;
    state.lastSurfaceProps = null;
    state.mounted = null;
    state.mounts = 0;
    markerOrder.length = 0;
    markerData.clear();
  },
};
