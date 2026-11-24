import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { AppleSignInButtonProps, AppleSignInResult } from '@/platform/auth/types';
import type { PageKeyEvent } from '@/platform/links/types';
import type { MapHandle, MapLayerSpec, MapStatus, MapSurfaceProps } from '@/platform/map/types';
import type { VideoSurfaceProps } from '@/platform/video/types';
import { resetPlatformFakes } from '@/test/platform';
import { auth, authFake } from '@/test/platform/auth';
import { links, linksFake } from '@/test/platform/links';
import { map, mapFake } from '@/test/platform/map';
import { video, videoFake } from '@/test/platform/video';

function layer(id: string): MapLayerSpec {
  return {
    id,
    type: 'fill',
    source: 'fixture-source',
    sourceLayer: 'fixture',
    before: 'fixture-anchor',
    minzoom: null,
    maxzoom: null,
    filter: null,
    layout: {},
    paint: {},
    webOnly: false,
  };
}

function surfaceProps(overrides: Partial<MapSurfaceProps>): MapSurfaceProps {
  return {
    styleUrl: 'https://example.test/style.json',
    sources: [
      {
        id: 'fixture-source',
        tiles: ['https://example.test/{z}/{x}/{y}'],
        minzoom: 0,
        maxzoom: 12,
      },
    ],
    geojsonSources: [],
    layers: [],
    initialBounds: [0, 0, 1, 1],
    initialPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    maxBounds: null,
    minZoom: 3,
    maxZoom: 16,
    attributionPosition: 'bottom-right',
    attributionCompact: true,
    webStyle: null,
    onStatus: () => undefined,
    handleRef: null,
    accessibilityLabel: 'Fixture map',
    testID: 'fixture.map',
    ...overrides,
  };
}

function videoProps(overrides: Partial<VideoSurfaceProps>): VideoSurfaceProps {
  return {
    itemId: 'fixture-1',
    source: { uri: 'https://example.test/fixture.mp4', cacheKey: 'fixture-1' },
    muted: true,
    playing: true,
    contentFit: 'cover',
    testID: 'fixture.video',
    ...overrides,
  };
}

function appleProps(overrides: Partial<AppleSignInButtonProps>): AppleSignInButtonProps {
  return {
    nonceHash: 'fixture-nonce-hash',
    state: 'fixture-state',
    appearance: {
      appleStyle: 'black',
      googleTheme: 'outline',
      googleShape: 'pill',
      googleSize: 'large',
      width: 280,
      height: 44,
    },
    disabled: false,
    onStart: () => undefined,
    onResult: () => undefined,
    testID: 'fixture.apple',
    accessibilityLabel: 'Fixture Apple',
    ...overrides,
  };
}

function MutedReader({ testID }: { testID: string }): ReactElement {
  const { muted } = video.useMuted();
  return <span data-testid={testID}>{muted ? 'muted' : 'sound'}</span>;
}

function MutedWriter(): ReactElement {
  const store = video.useMuted();
  return (
    <button
      type="button"
      data-testid="fixture.unmute"
      onClick={() => {
        store.setMuted(false);
      }}
    />
  );
}

describe('the component fakes', () => {
  it('component fakes render a view with their testID', () => {
    render(
      <>
        <map.Surface {...surfaceProps({})}>
          <map.Marker coordinate={[0, 0]} anchor="center" testID="fixture.marker">
            <span data-testid="fixture.marker-child" />
          </map.Marker>
        </map.Surface>
        <video.Surface {...videoProps({})} />
        <auth.AppleSignInButton {...appleProps({})} />
        <auth.GoogleSignInButton
          {...appleProps({})}
          onResult={() => undefined}
          testID="fixture.google"
        />
      </>,
    );
    for (const id of [
      'fixture.map',
      'fixture.marker',
      'fixture.video',
      'fixture.apple',
      'fixture.google',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(
      screen.getByTestId('fixture.marker').contains(screen.getByTestId('fixture.marker-child')),
    ).toBe(true);
    expect(authFake.calls).toEqual([
      { op: 'mount', provider: 'apple', nonceHash: 'fixture-nonce-hash', state: 'fixture-state' },
      { op: 'mount', provider: 'google', nonceHash: 'fixture-nonce-hash' },
    ]);
  });

  it('the map fake records props and handle calls', async () => {
    const handleRef = createRef<MapHandle>();
    const statuses: MapStatus[] = [];
    render(
      <map.Surface
        {...surfaceProps({
          layers: [layer('fixture-fill'), layer('fixture-line')],
          geojsonSources: [
            { id: 'fixture-overlay', data: { type: 'FeatureCollection', features: [] } },
          ],
          handleRef,
          onStatus: (status) => {
            statuses.push(status);
          },
        })}
      />,
    );

    expect(mapFake.lastProps()).toEqual({
      styleUrl: 'https://example.test/style.json',
      layerIds: ['fixture-fill', 'fixture-line'],
      sourceIds: ['fixture-source'],
      geojson: { 'fixture-overlay': { type: 'FeatureCollection', features: [] } },
      maxBounds: null,
      attributionCompact: true,
    });

    const target = { sourceId: 'fixture-source', sourceLayer: 'fixture', id: 7 };
    const handle = handleRef.current;
    expect(handle).not.toBeNull();
    handle?.setFeatureState(target, { selected: true });
    await expect(handle?.queryRenderedFeatures('center', ['fixture-fill'])).resolves.toEqual([]);
    expect(mapFake.calls).toEqual([
      { op: 'setFeatureState', target, state: { selected: true } },
      { op: 'queryRenderedFeatures', at: 'center', layerIds: ['fixture-fill'], radius: null },
    ]);

    mapFake.emitStatus({ kind: 'ready', styleErrors: 0 });
    expect(statuses).toEqual([{ kind: 'ready', styleErrors: 0 }]);
  });

  it('the video fake records mount, update and unmount', () => {
    const firstFrames: string[] = [];
    const props = videoProps({
      onFirstFrame: () => {
        firstFrames.push('fixture-1');
      },
    });
    const { rerender, unmount } = render(<video.Surface {...props} />);
    videoFake.emitFirstFrame('fixture-1');
    expect(firstFrames).toEqual(['fixture-1']);

    rerender(<video.Surface {...props} playing={false} />);
    unmount();
    expect(videoFake.calls).toEqual([
      { op: 'mount', itemId: 'fixture-1', muted: true, playing: true },
      { op: 'update', itemId: 'fixture-1', muted: true, playing: false },
      { op: 'unmount', itemId: 'fixture-1' },
    ]);

    render(
      <>
        <MutedReader testID="fixture.reader" />
        <MutedWriter />
      </>,
    );
    expect(screen.getByTestId('fixture.reader').textContent).toBe('muted');
    act(() => {
      screen.getByTestId('fixture.unmute').click();
    });
    expect(screen.getByTestId('fixture.reader').textContent).toBe('sound');
    expect(videoFake.calls.at(-1)).toEqual({ op: 'setMuted', muted: false });
  });

  it('the auth fake drives a sign-in result', () => {
    const seen: string[] = [];
    const results: AppleSignInResult[] = [];
    render(
      <auth.AppleSignInButton
        {...appleProps({
          onStart: () => {
            seen.push('start');
          },
          onResult: (result) => {
            seen.push('result');
            results.push(result);
          },
        })}
      />,
    );
    authFake.emitApple({ kind: 'cancelled' });
    expect(seen).toEqual(['start', 'result']);
    expect(results).toEqual([{ kind: 'cancelled' }]);
  });

  it('the links fake emits key presses', () => {
    const received: string[] = [];
    const unsubscribe = links.subscribeKeyDown((event) => {
      received.push(event.key);
    });
    const event: PageKeyEvent = {
      key: 'k',
      altKey: false,
      ctrlKey: false,
      metaKey: true,
      inTextField: false,
      preventDefault: () => undefined,
    };
    linksFake.emitKey(event);
    unsubscribe();
    linksFake.emitKey(event);
    expect(received).toEqual(['k']);
    expect(linksFake.calls).toEqual([{ op: 'subscribeKeyDown' }]);
  });

  it('resetPlatformFakes drops mounted components', () => {
    const statuses: MapStatus[] = [];
    const firstFrames: string[] = [];
    const appleStarts: string[] = [];
    const { unmount } = render(
      <>
        <map.Surface
          {...surfaceProps({
            onStatus: (status) => {
              statuses.push(status);
            },
          })}
        />
        <video.Surface
          {...videoProps({
            onFirstFrame: () => {
              firstFrames.push('fixture-1');
            },
          })}
        />
        <auth.AppleSignInButton
          {...appleProps({
            onStart: () => {
              appleStarts.push('start');
            },
          })}
        />
      </>,
    );
    unmount();
    resetPlatformFakes();

    expect(() => {
      mapFake.emitStatus({ kind: 'loading' });
      videoFake.emitFirstFrame('fixture-1');
      authFake.emitApple({ kind: 'cancelled' });
    }).not.toThrow();
    expect(statuses).toEqual([]);
    expect(firstFrames).toEqual([]);
    expect(appleStarts).toEqual([]);
    expect(mapFake.lastProps()).toBeNull();
    expect(mapFake.calls).toEqual([]);
  });

  it('resetPlatformFakes forgets a component that is still mounted', () => {
    const statuses: MapStatus[] = [];
    render(
      <map.Surface
        {...surfaceProps({
          onStatus: (status) => {
            statuses.push(status);
          },
        })}
      />,
    );
    mapFake.emitStatus({ kind: 'loading' });
    resetPlatformFakes();
    mapFake.emitStatus({ kind: 'ready', styleErrors: 0 });
    expect(statuses).toEqual([{ kind: 'loading' }]);
  });
});
