import { useEffect, useImperativeHandle } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import type {
  FeatureTarget,
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

const calls: MapFakeCall[] = [];
const state: {
  features: readonly MapFeature[];
  lastProps: MapFakeProps | null;
  mounted: MapSurfaceProps | null;
} = { features: [], lastProps: null, mounted: null };

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

function Surface(props: MapSurfaceProps): ReactElement {
  useImperativeHandle(props.handleRef, () => handle, []);
  // Registered in an effect with a cleanup, so an unmounted surface is never called.
  useEffect(() => {
    state.lastProps = describeProps(props);
    state.mounted = props;
    return () => {
      if (state.mounted === props) {
        state.mounted = null;
      }
    };
  });
  return <View testID={props.testID}>{props.children}</View>;
}

function Marker({ children, testID }: MapMarkerProps): ReactElement {
  return <View testID={testID}>{children}</View>;
}

export const map: MapModule = { Surface, Marker };

export const mapFake = {
  calls: calls as readonly MapFakeCall[],
  lastProps: (): MapFakeProps | null => state.lastProps,
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
    state.mounted = null;
  },
};
