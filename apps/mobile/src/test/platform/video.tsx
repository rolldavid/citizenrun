import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import type { VideoModule, VideoSurfaceProps } from '@/platform/video/types';

export type VideoFakeCall =
  | { op: 'mount' | 'update'; itemId: string; muted: boolean; playing: boolean }
  | { op: 'unmount' | 'preload' | 'cancelPreload'; itemId: string }
  | { op: 'setMuted'; muted: boolean };

const calls: VideoFakeCall[] = [];
const surfaces = new Map<string, VideoSurfaceProps>();
const mutedListeners = new Set<() => void>();
const state = { muted: true };

function subscribeMuted(listener: () => void): () => void {
  mutedListeners.add(listener);
  return () => {
    mutedListeners.delete(listener);
  };
}

function readMuted(): boolean {
  return state.muted;
}

function setMuted(muted: boolean): void {
  calls.push({ op: 'setMuted', muted });
  state.muted = muted;
  for (const listener of [...mutedListeners]) {
    listener();
  }
}

function Surface(props: VideoSurfaceProps): ReactElement {
  const { itemId, muted, playing, testID } = props;
  const mountedId = useRef<string | null>(null);

  useEffect(() => {
    calls.push({ op: mountedId.current === itemId ? 'update' : 'mount', itemId, muted, playing });
    mountedId.current = itemId;
  }, [itemId, muted, playing]);

  useEffect(
    () => () => {
      calls.push({ op: 'unmount', itemId });
      mountedId.current = null;
    },
    [itemId],
  );

  // Registered in an effect with a cleanup, so an unmounted surface is never called.
  useEffect(() => {
    surfaces.set(props.itemId, props);
    return () => {
      if (surfaces.get(props.itemId) === props) {
        surfaces.delete(props.itemId);
      }
    };
  });

  return <View testID={testID} />;
}

export const video: VideoModule = {
  visibleThreshold: 60,
  controller: {
    preload: (itemId) => {
      calls.push({ op: 'preload', itemId });
    },
    cancelPreload: (itemId) => {
      calls.push({ op: 'cancelPreload', itemId });
    },
    getActiveId: () => null,
  },
  Surface,
  useMuted: () => ({ muted: useSyncExternalStore(subscribeMuted, readMuted, readMuted), setMuted }),
};

export const videoFake = {
  calls: calls as readonly VideoFakeCall[],
  /** Calls the mounted surface's onFirstFrame for this item. */
  emitFirstFrame: (itemId: string): void => {
    surfaces.get(itemId)?.onFirstFrame?.();
  },
  /** Calls the mounted surface's onError for this item. */
  emitError: (itemId: string): void => {
    surfaces.get(itemId)?.onError?.('video.playback_failed');
  },
  /** Calls the mounted surface's onAutoplayBlocked for this item. */
  emitAutoplayBlocked: (itemId: string): void => {
    surfaces.get(itemId)?.onAutoplayBlocked?.();
  },
  reset: (): void => {
    calls.length = 0;
    surfaces.clear();
    mutedListeners.clear();
    state.muted = true;
  },
};
