import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { ScrollView, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { head } from '@/platform/head';
import { map } from '@/platform/map';
import type { MapHandle, MapPadding, MapStatus } from '@/platform/map';
import { Button } from '@/ui/components/button';
import { Screen } from '@/ui/components/screen';
import { Text } from '@/ui/components/text';
import { useReducedMotion, useSpringScale } from '@/ui/motion';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { ThemeProvider, useTheme } from '@/ui/theme';
import type { ThemeChoice } from '@/ui/theme';
import { mapRamp, mapStyle, rule, size, space } from '@/ui/tokens';

import {
  ALASKA_FIT,
  ALASKA_MAX,
  LOWER48_MAX,
  SPIKE_BOUNDS,
  SPIKE_CENTRE,
  SPIKE_CLOSE_BOUNDS,
  SPIKE_MAX_ZOOM,
  SPIKE_MIN_ZOOM,
  buildSpikeLayers,
  spikeGeoJson,
  spikeStyleUrl,
  spikeVectorSource,
  spikeWebStyle,
} from './map-spike-layers';
import type { EmptyMode, MapSpikeToggles, SpikeRegion } from './map-spike-layers';
import { SpikeGround } from './spike-ground';
import { spikeServerOrigin } from './spike-server';

export type MapSpikeScreenProps = {
  /** The API origin of this target: '' on the web, where the page and the API share one. */
  apiOrigin: string;
  /** The `spikeOrigin` route parameter, or null when the address has none. */
  spikeOrigin: string | null;
};

type AttributionCorner = 'bottom-right' | 'top-left';

const NEXT_THEME: Readonly<Record<ThemeChoice, ThemeChoice>> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};
const NEXT_EMPTY: Readonly<Record<EmptyMode, EmptyMode>> = {
  '204': '200',
  '200': '404',
  '404': '204',
};
const NO_TOGGLES: MapSpikeToggles = {
  dimmed: false,
  ringsFaded: false,
  filtered: false,
  tagsHidden: false,
};
/** The one cell the spike selects, by its tile feature id (D-052). */
const SELECTED_CELL = { sourceId: 'spike', sourceLayer: 'cells', id: 5 } as const;
const INITIAL_PADDING: MapPadding = {
  top: space.x4,
  right: space.x4,
  bottom: space.x4,
  left: space.x4,
};
// On a phone the view starts close on the cells: room at each side for the names of the line's
// ends, and under the cells for the attribution, which starts open on two lines.
const INITIAL_PADDING_COMPACT: MapPadding = {
  top: space.x8,
  right: space.x8,
  bottom: space.x12 + space.x4,
  left: space.x8,
};

const HEADER: ViewStyle = { paddingVertical: space.x4 };
const FILL: ViewStyle = { flex: 1 };
const WORK_COLUMN: ViewStyle = { flex: 1 };
const WORK_ROW: ViewStyle = { flex: 1, flexDirection: 'row' };
const PANEL_UNDER: ViewStyle = { flexGrow: 0, maxHeight: '45%', borderTopWidth: rule.hairline };
const PANEL_BESIDE: ViewStyle = {
  flexGrow: 0,
  width: size.rightColumn,
  borderLeftWidth: rule.hairline,
};
const PANEL_BODY: ViewStyle = { gap: space.x4 };
const LINES: ViewStyle = { gap: space.x1 };
const CONTROLS: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: space.x2 };
// The selected pin, one size up from the largest pin (D-203).
const MARKER: ViewStyle = {
  width: mapStyle.selectedPinLarge,
  height: mapStyle.selectedPinLarge,
  borderRadius: mapStyle.selectedPinLarge / 2,
  borderWidth: mapStyle.pinKeyline,
};

function statusText(status: MapStatus): string {
  switch (status.kind) {
    case 'loading':
      return 'loading';
    case 'ready':
      return `ready ${String(status.styleErrors)}`;
    case 'error':
      return `error ${status.code}`;
  }
}

/** The marker: an ink disc that springs up from the largest pin's size each time `liftKey` changes. */
function SpikeMarker({ liftKey }: { liftKey: number | null }): JSX.Element {
  const theme = useTheme();
  const lift = useSpringScale(liftKey, size.pin.large / mapStyle.selectedPinLarge);
  return (
    <Animated.View
      style={[
        MARKER,
        { backgroundColor: theme.color.pinBg, borderColor: theme.color.pinKeyline },
        lift,
      ]}
    />
  );
}

/** One line of what the spike is doing, in a fixed form: the capture run waits on the first. */
function Line({ testID, children }: { testID: string; children: string }): JSX.Element {
  return (
    <Text role="mono" tone="secondary" testID={testID}>
      {children}
    </Text>
  );
}

/** One control of the panel: a quiet button named by what pressing it does. */
function Control(props: { testID: string; label: string; onPress: () => void }): JSX.Element {
  return (
    <Button
      variant="secondary"
      size="sm"
      label={props.label}
      onPress={props.onPress}
      testID={props.testID}
    />
  );
}

function MapSpikeBody({
  apiOrigin,
  spikeOrigin,
  choice,
  onCycleTheme,
}: MapSpikeScreenProps & { choice: ThemeChoice; onCycleTheme: () => void }): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const reduced = useReducedMotion();
  const [toggles, setToggles] = useState<MapSpikeToggles>(NO_TOGGLES);
  const [selected, setSelected] = useState(false);
  const [geo, setGeo] = useState<'a' | 'b'>('a');
  const [empty, setEmpty] = useState<EmptyMode>('204');
  const [region, setRegion] = useState<SpikeRegion>('spike');
  const [attributionPosition, setAttributionPosition] = useState<AttributionCorner>('bottom-right');
  const [attributionCompact, setAttributionCompact] = useState(true);
  const [status, setStatus] = useState<MapStatus>({ kind: 'loading' });
  const [query, setQuery] = useState('none');
  const [liftKey, setLiftKey] = useState<number | null>(null);
  const handleRef = useRef<MapHandle | null>(null);

  const origin = useMemo(() => spikeServerOrigin(apiOrigin, spikeOrigin), [apiOrigin, spikeOrigin]);
  const styleUrl = useMemo(
    () => spikeStyleUrl(origin, theme.name, empty),
    [origin, theme.name, empty],
  );
  const sources = useMemo(() => [spikeVectorSource(origin, empty)], [origin, empty]);
  const geojsonSources = useMemo(() => [spikeGeoJson(geo)], [geo]);
  const layers = useMemo(
    () =>
      buildSpikeLayers({
        colors: theme.color,
        ramp: mapRamp.neutral[theme.name],
        toggles,
        reducedMotion: reduced,
      }),
    [theme.color, theme.name, toggles, reduced],
  );
  const webStyle = useMemo(() => spikeWebStyle(theme.color), [theme.color]);

  // A style reload drops feature state, so the selection is set again each time the map is ready.
  const ready = status.kind === 'ready';
  useEffect(() => {
    if (!ready) return;
    handleRef.current?.setFeatureState(SELECTED_CELL, { selected });
  }, [selected, ready]);

  const flip = (name: keyof MapSpikeToggles): void => {
    setToggles((current) => ({ ...current, [name]: !current[name] }));
  };
  const queryCentre = async (): Promise<void> => {
    const handle = handleRef.current;
    if (handle === null) return;
    const found = await handle.queryRenderedFeatures('center', ['spike-hit'], size.pinHitRadius);
    const ids = found.map((feature) => (feature.id === null ? 'no id' : String(feature.id)));
    setQuery(`centre ${String(found.length)} features: ${ids.join(', ')}`);
  };
  const queryViewport = async (): Promise<void> => {
    const handle = handleRef.current;
    if (handle === null) return;
    const found = await handle.queryRenderedFeatures('viewport', ['spike-cells-fill']);
    setQuery(`viewport ${String(found.length)} cell features`);
  };

  const beside = layout.breakpoint !== 'compact';
  // The whole fixture tile where the map is wide; on a phone, the cells alone.
  const spikeBounds = beside ? SPIKE_BOUNDS : SPIKE_CLOSE_BOUNDS;
  // The frame keeps a gutter at each side for the heading; the map and the panel reach the edges.
  const bleed: ViewStyle = { marginHorizontal: -layout.gutter };

  return (
    <Screen width="full" scroll={false} appBar={null} testID="dev.map-spike">
      <head.Title>Map spike</head.Title>
      <View style={HEADER}>
        <Text role="heading" heading={1}>
          Map spike
        </Text>
      </View>
      <View style={[beside ? WORK_ROW : WORK_COLUMN, bleed]}>
        <View style={FILL}>
          {/* A change of region, empty mode or reduced motion starts a new map: the first view and
              the transitions are read only when one is made. */}
          <map.Surface
            key={`${region}-${empty}-${reduced ? 'reduced' : 'motion'}`}
            styleUrl={styleUrl}
            sources={sources}
            geojsonSources={geojsonSources}
            layers={layers}
            initialBounds={region === 'spike' ? spikeBounds : ALASKA_FIT}
            initialPadding={beside ? INITIAL_PADDING : INITIAL_PADDING_COMPACT}
            maxBounds={region === 'spike' ? LOWER48_MAX : ALASKA_MAX}
            minZoom={SPIKE_MIN_ZOOM}
            maxZoom={SPIKE_MAX_ZOOM}
            attributionPosition={attributionPosition}
            attributionCompact={attributionCompact}
            webStyle={webStyle}
            onStatus={setStatus}
            handleRef={handleRef}
            accessibilityLabel="Map spike: test layers over the base map"
            testID="dev.map-spike-surface"
          >
            <map.Marker coordinate={SPIKE_CENTRE} anchor="center" testID="dev.map-spike-marker">
              <SpikeMarker liftKey={liftKey} />
            </map.Marker>
          </map.Surface>
        </View>
        <ScrollView
          style={[beside ? PANEL_BESIDE : PANEL_UNDER, { borderColor: theme.color.rule }]}
          contentContainerStyle={[PANEL_BODY, { padding: beside ? space.x4 : layout.gutter }]}
          testID="dev.map-spike-panel"
        >
          <View style={LINES}>
            <Line testID="dev.map-spike-status">{statusText(status)}</Line>
            <Line testID="dev.map-spike-origin">{`server ${origin}`}</Line>
            <Line testID="dev.map-spike-mode">
              {`empty ${empty}, region ${region}, line ${geo === 'a' ? 'A' : 'B'}`}
            </Line>
            <Line testID="dev.map-spike-query">{query === 'none' ? 'query none' : query}</Line>
          </View>
          <View style={CONTROLS}>
            <Control
              testID="dev.map-spike-theme"
              label={`Theme: ${choice}`}
              onPress={onCycleTheme}
            />
            <Control
              testID="dev.map-spike-dim"
              label={toggles.dimmed ? 'Undim cells' : 'Dim cells'}
              onPress={() => {
                flip('dimmed');
              }}
            />
            <Control
              testID="dev.map-spike-rings"
              label={toggles.ringsFaded ? 'Show rings' : 'Fade rings'}
              onPress={() => {
                flip('ringsFaded');
              }}
            />
            <Control
              testID="dev.map-spike-filter"
              label={toggles.filtered ? 'Show every cell' : 'Show cells 1 to 3'}
              onPress={() => {
                flip('filtered');
              }}
            />
            <Control
              testID="dev.map-spike-tags"
              label={toggles.tagsHidden ? 'Show tags' : 'Hide tags'}
              onPress={() => {
                flip('tagsHidden');
              }}
            />
            <Control
              testID="dev.map-spike-select"
              label={selected ? 'Clear cell 5' : 'Select cell 5'}
              onPress={() => {
                setSelected((current) => !current);
              }}
            />
            <Control
              testID="dev.map-spike-geojson"
              label={geo === 'a' ? 'Line data: A' : 'Line data: B'}
              onPress={() => {
                setGeo((current) => (current === 'a' ? 'b' : 'a'));
              }}
            />
            <Control
              testID="dev.map-spike-query-centre"
              label="Query centre"
              onPress={() => {
                void queryCentre();
              }}
            />
            <Control
              testID="dev.map-spike-query-viewport"
              label="Query viewport"
              onPress={() => {
                void queryViewport();
              }}
            />
            <Control
              testID="dev.map-spike-lift"
              label="Lift marker"
              onPress={() => {
                setLiftKey((current) => (current ?? 0) + 1);
              }}
            />
            <Control
              testID="dev.map-spike-empty"
              label={`Empty tiles: ${empty}`}
              onPress={() => {
                setEmpty((current) => NEXT_EMPTY[current]);
              }}
            />
            <Control
              testID="dev.map-spike-region"
              label={region === 'spike' ? 'Region: spike area' : 'Region: Alaska'}
              onPress={() => {
                setRegion((current) => (current === 'spike' ? 'alaska' : 'spike'));
              }}
            />
            <Control
              testID="dev.map-spike-attribution-position"
              label={
                attributionPosition === 'bottom-right'
                  ? 'Attribution: bottom right'
                  : 'Attribution: top left'
              }
              onPress={() => {
                setAttributionPosition((current) =>
                  current === 'bottom-right' ? 'top-left' : 'bottom-right',
                );
              }}
            />
            <Control
              testID="dev.map-spike-attribution-compact"
              label={attributionCompact ? 'Compact attribution: on' : 'Compact attribution: off'}
              onPress={() => {
                setAttributionCompact((current) => !current);
              }}
            />
          </View>
        </ScrollView>
      </View>
    </Screen>
  );
}

/** SCR-dev-spikes: the map spike (D-100 row 6). Deleted with the real map screen. */
export function MapSpikeScreen({ apiOrigin, spikeOrigin }: MapSpikeScreenProps): JSX.Element {
  const outer = useTheme();
  // The spike's own theme choice: the innermost provider wins.
  const [choice, setChoice] = useState<ThemeChoice>('system');
  return (
    <ThemeProvider choice={choice} textScale={outer.textScale}>
      <SpikeGround />
      <MapSpikeBody
        apiOrigin={apiOrigin}
        spikeOrigin={spikeOrigin}
        choice={choice}
        onCycleTheme={() => {
          setChoice((current) => NEXT_THEME[current]);
        }}
      />
    </ThemeProvider>
  );
}
