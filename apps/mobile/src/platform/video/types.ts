import type { ComponentType } from 'react';

/** A playable source: a Media video URL and its stable key, or a local file for the composer's preview. */
export type VideoSource = { uri: string; cacheKey: string };

export type VideoErrorCode = 'video.playback_failed';

export type VideoSurfaceProps = {
  /** The item this surface plays; the key of a clip preloaded with controller.preload. */
  itemId: string;
  source: VideoSource;
  /** The feature's app-wide mute state; true until the person turns sound on. */
  muted: boolean;
  /** False holds the first frame (C-VideoPlayer's `autoplay` off until its play control is pressed). */
  playing: boolean;
  contentFit: 'cover' | 'contain';
  /** The first frame is on screen (the caller may stop drawing the poster). */
  onFirstFrame?: () => void;
  onError?: (code: VideoErrorCode) => void;
  /** Web: the browser refused to start playback (an autoplay rule). The cell keeps its poster and C-VideoPlayer shows its play block. Never called on phones. */
  onAutoplayBlocked?: () => void;
  testID: string;
};

export interface VideoController {
  /** Loads the next clip into the spare player without playing it (D-177). A later preload replaces it. */
  preload(itemId: string, source: VideoSource): void;
  /** Drops a preloaded clip that will not be shown. */
  cancelPreload(itemId: string): void;
  /** The item whose surface holds the playing player, or null. */
  getActiveId(): string | null;
}

export interface VideoModule {
  /** Percent of a cell that must be visible before it may play (D-177): 60. */
  readonly visibleThreshold: 60;
  readonly controller: VideoController;
  Surface: ComponentType<VideoSurfaceProps>;
  /** The app-wide mute state: true at every launch and again whenever the app goes to the background or the page
   *  is hidden, kept in memory only, shared by every caller (D-543). */
  useMuted(): { muted: boolean; setMuted(muted: boolean): void };
}
