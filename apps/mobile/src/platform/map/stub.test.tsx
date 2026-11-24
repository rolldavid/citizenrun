import { render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MapHandle, MapMarkerProps, MapSurfaceProps } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = ['Marker', 'Surface'];

function surfaceFixture(handleRef: MapSurfaceProps['handleRef']) {
  return {
    styleUrl: 'https://example.test/map/style-light.json',
    sources: [
      {
        id: 'fixture-districts',
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
      {
        id: 'fixture-fill',
        type: 'fill',
        source: 'fixture-districts',
        sourceLayer: 'districts',
        before: 'anchor-fill',
        minzoom: null,
        maxzoom: null,
        filter: null,
        layout: {},
        paint: { 'fill-opacity': 0.4 },
        webOnly: false,
      },
    ],
    initialBounds: [-84.32, 33.84, -75.46, 36.59],
    initialPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    maxBounds: null,
    minZoom: 3,
    maxZoom: 16,
    attributionPosition: 'bottom-right',
    attributionCompact: true,
    webStyle: null,
    onStatus: () => undefined,
    handleRef,
    accessibilityLabel: 'Fixture map',
    testID: 'map.fixture-surface',
  } satisfies MapSurfaceProps;
}

const markerFixture = {
  coordinate: [-78.64, 35.78],
  anchor: 'bottom',
  children: null,
  testID: 'map.fixture-marker',
} satisfies MapMarkerProps;

describe('map stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.map).sort();
    expect(nativeKeys).toEqual(Object.keys(web.map).sort());
    expect(nativeKeys).toEqual(MEMBERS);
    for (const later of ['hoverSupported', 'keyboardSupported', 'preload']) {
      expect(nativeKeys).not.toContain(later);
    }
  });

  describe.each([
    ['index.native', native.map],
    ['index.web', web.map],
  ])('%s', (_file, map) => {
    it('the surface and the marker render nothing', () => {
      const { Surface, Marker } = map;
      const handleRef = createRef<MapHandle>();

      const surface = render(<Surface {...surfaceFixture(handleRef)} />);
      expect(surface.container.childNodes).toHaveLength(0);
      expect(handleRef.current).toBeNull();
      surface.unmount();

      const marker = render(<Marker {...markerFixture} />);
      expect(marker.container.childNodes).toHaveLength(0);
      marker.unmount();
    });
  });
});
