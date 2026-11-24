import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { map } from '@/platform/map';
import type { MapLayerSpec, MapSurfaceProps } from '@/platform/map/types';
import { resetPlatformFakes } from '@/test/platform';
import { mapFake } from '@/test/platform/map';

function layer(id: string, overrides: Partial<MapLayerSpec> = {}): MapLayerSpec {
  return {
    id,
    type: 'fill',
    source: 'fixture-source',
    sourceLayer: 'fixture',
    before: 'anchor-fill',
    minzoom: null,
    maxzoom: null,
    filter: null,
    layout: {},
    paint: {},
    webOnly: false,
    ...overrides,
  };
}

const recorded = {
  styleUrl: 'https://example.test/style-light.json',
  sources: [
    {
      id: 'fixture-source',
      tiles: ['https://example.test/tiles/{z}/{x}/{y}.pbf'],
      minzoom: 3,
      maxzoom: 12,
    },
  ],
  geojsonSources: [
    {
      id: 'fixture-overlay',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            id: 1,
            geometry: { type: 'Point', coordinates: [-78.64, 35.78] },
            properties: { name: 'Fixture point' },
          },
        ],
      },
    },
  ],
  layers: [
    layer('fixture-fill', { paint: { 'fill-opacity': 0.4 } }),
    layer('fixture-dot', {
      type: 'circle',
      source: 'fixture-overlay',
      sourceLayer: null,
      before: 'anchor-top',
    }),
  ],
  initialBounds: [-84.32, 33.84, -75.46, 36.59],
  initialPadding: { top: 8, right: 8, bottom: 8, left: 8 },
  maxBounds: [-90, 30, -70, 40],
  minZoom: 3,
  maxZoom: 16,
  attributionPosition: 'bottom-right',
  attributionCompact: false,
  webStyle: {
    css: '.maplibregl-ctrl-attrib { font-family: inherit; }',
    cssVariables: { '--fixture-ink': 'inherit' },
  },
  accessibilityLabel: 'Fixture map',
  testID: 'fixture.map',
} satisfies Omit<MapSurfaceProps, 'onStatus' | 'onFocusChange' | 'handleRef' | 'children'>;

function surfaceProps(overrides: Partial<MapSurfaceProps> = {}): MapSurfaceProps {
  return {
    ...recorded,
    onStatus: () => undefined,
    onFocusChange: () => undefined,
    handleRef: null,
    ...overrides,
  };
}

describe('the map fake', () => {
  it('the fake keeps every surface prop', () => {
    render(<map.Surface {...surfaceProps()} />);
    const kept = mapFake.lastSurfaceProps();
    expect(kept).toEqual(recorded);
    expect(kept).not.toHaveProperty('onStatus');
    expect(kept).not.toHaveProperty('onFocusChange');
    expect(kept).not.toHaveProperty('handleRef');
    expect(kept).not.toHaveProperty('children');
  });

  it('a later render replaces the kept props', () => {
    const { rerender } = render(<map.Surface {...surfaceProps()} />);
    rerender(
      <map.Surface {...surfaceProps({ styleUrl: 'https://example.test/style-dark.json' })} />,
    );
    expect(mapFake.lastSurfaceProps()?.styleUrl).toBe('https://example.test/style-dark.json');
    expect(mapFake.mountCount()).toBe(1);
  });

  it('remounts are counted', () => {
    const { rerender } = render(<map.Surface key="a" {...surfaceProps()} />);
    rerender(<map.Surface key="b" {...surfaceProps()} />);
    expect(mapFake.mountCount()).toBe(2);
  });

  it('markers are listed', () => {
    const { rerender } = render(
      <map.Surface {...surfaceProps()}>
        <map.Marker key="a" coordinate={[-78.64, 35.78]} anchor="bottom" testID="fixture.marker-a">
          {null}
        </map.Marker>
        <map.Marker key="b" coordinate={[-80.84, 35.23]} anchor="center" testID="fixture.marker-b">
          {null}
        </map.Marker>
      </map.Surface>,
    );
    expect(mapFake.markers()).toEqual([
      { testID: 'fixture.marker-a', coordinate: [-78.64, 35.78], anchor: 'bottom' },
      { testID: 'fixture.marker-b', coordinate: [-80.84, 35.23], anchor: 'center' },
    ]);

    rerender(
      <map.Surface {...surfaceProps()}>
        <map.Marker key="b" coordinate={[-80.84, 35.23]} anchor="center" testID="fixture.marker-b">
          {null}
        </map.Marker>
      </map.Surface>,
    );
    expect(mapFake.markers()).toEqual([
      { testID: 'fixture.marker-b', coordinate: [-80.84, 35.23], anchor: 'center' },
    ]);
  });

  it('a marker that moves is listed where it is now', () => {
    const { rerender } = render(
      <map.Surface {...surfaceProps()}>
        <map.Marker key="a" coordinate={[-78.64, 35.78]} anchor="bottom" testID="fixture.marker-a">
          {null}
        </map.Marker>
      </map.Surface>,
    );
    rerender(
      <map.Surface {...surfaceProps()}>
        <map.Marker key="a" coordinate={[-79.05, 35.91]} anchor="bottom" testID="fixture.marker-a">
          {null}
        </map.Marker>
      </map.Surface>,
    );
    expect(mapFake.markers()).toEqual([
      { testID: 'fixture.marker-a', coordinate: [-79.05, 35.91], anchor: 'bottom' },
    ]);
  });

  it('reset clears the new records', () => {
    render(
      <map.Surface {...surfaceProps()}>
        <map.Marker key="a" coordinate={[-78.64, 35.78]} anchor="bottom" testID="fixture.marker-a">
          {null}
        </map.Marker>
      </map.Surface>,
    );
    expect(mapFake.mountCount()).toBe(1);
    resetPlatformFakes();
    expect(mapFake.lastSurfaceProps()).toBeNull();
    expect(mapFake.mountCount()).toBe(0);
    expect(mapFake.markers()).toEqual([]);
  });
});
