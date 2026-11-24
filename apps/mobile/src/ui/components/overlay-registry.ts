import { useEffect, useRef } from 'react';

export type OverlayKind = 'sheet' | 'dialog' | 'tooltip';

/** One open overlay. A fresh object per call, so two overlays that share a close function stay apart. */
type OpenOverlay = { close: () => void };

// The overlay open now, by kind. One of a kind is open at a time.
const openByKind = new Map<OverlayKind, OpenOverlay>();

/** Registers an open overlay and calls close() on the overlay of the same kind that was open before it. Returns the unregister function. */
export function openOverlay(kind: OverlayKind, close: () => void): () => void {
  const before = openByKind.get(kind);
  const entry: OpenOverlay = { close };
  openByKind.set(kind, entry);
  before?.close();
  return () => {
    // An overlay that was closed by a later one has already lost its place.
    if (openByKind.get(kind) === entry) {
      openByKind.delete(kind);
    }
  };
}

/** True while a sheet or a dialog is open. */
export function isModalOverlayOpen(): boolean {
  return openByKind.has('sheet') || openByKind.has('dialog');
}

/** Registers while `open` is true. */
export function useOverlay(kind: OverlayKind, open: boolean, close: () => void): void {
  // The caller's latest close, so a new function each render does not register again.
  const latest = useRef(close);

  useEffect(() => {
    latest.current = close;
  }, [close]);

  useEffect(() => {
    if (!open) return undefined;
    return openOverlay(kind, () => {
      latest.current();
    });
  }, [kind, open]);
}
