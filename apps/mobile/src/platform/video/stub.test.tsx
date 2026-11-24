import { render, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlatformNotReadyError } from '@/platform/shared';
import type { VideoSource, VideoSurfaceProps } from './types';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';

const native = await vi.importActual<typeof NativeIndex>('./index.native');
const web = await vi.importActual<typeof WebIndex>('./index.web');

const MEMBERS = ['Surface', 'controller', 'useMuted', 'visibleThreshold'];

const fixtureSource: VideoSource = {
  uri: 'https://example.test/media/fixture.mp4',
  cacheKey: 'fixture-video',
};

const fixtureProps: VideoSurfaceProps = {
  itemId: 'fixture-item',
  source: fixtureSource,
  muted: true,
  playing: false,
  contentFit: 'cover',
  onFirstFrame: () => undefined,
  onError: () => undefined,
  onAutoplayBlocked: () => undefined,
  testID: 'video.fixture-surface',
};

function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error: unknown) {
    return error;
  }
  return null;
}

function expectNotReady(error: unknown, method: string): void {
  expect(error).toBeInstanceOf(PlatformNotReadyError);
  expect(error).toMatchObject({ module: 'video', method, code: 'video.not_ready' });
}

describe('video stub', () => {
  it('both files export the same members', () => {
    const nativeKeys = Object.keys(native.video).sort();
    expect(nativeKeys).toEqual(Object.keys(web.video).sort());
    expect(nativeKeys).toEqual(MEMBERS);
  });

  describe.each([
    ['index.native', native.video],
    ['index.web', web.video],
  ])('%s', (_file, video) => {
    it('the visible threshold is 60', () => {
      expect(video.visibleThreshold).toBe(60);
    });

    it('controller members throw PlatformNotReadyError', () => {
      const { controller } = video;
      expectNotReady(
        thrown(() => {
          controller.preload('fixture-item', fixtureSource);
        }),
        'controller.preload',
      );
      expectNotReady(
        thrown(() => {
          controller.cancelPreload('fixture-item');
        }),
        'controller.cancelPreload',
      );
      expectNotReady(
        thrown(() => controller.getActiveId()),
        'controller.getActiveId',
      );
    });

    it('the surface renders nothing', () => {
      const { Surface } = video;
      const surface = render(<Surface {...fixtureProps} />);
      expect(surface.container.childNodes).toHaveLength(0);
      surface.unmount();
    });

    it('useMuted throws PlatformNotReadyError', () => {
      // React reports the error thrown during render to the console before rethrowing it.
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expectNotReady(
        thrown(() => renderHook(() => video.useMuted())),
        'useMuted',
      );
    });
  });
});
