import { afterEach, describe, expect, it, vi } from 'vitest';

import { isModalOverlayOpen, openOverlay } from './overlay-registry';
import type { OverlayKind } from './overlay-registry';

// The registry is one module-level store, so every case hands back what it opened.
const opened: (() => void)[] = [];

function open(kind: OverlayKind, close: () => void = () => undefined): () => void {
  const unregister = openOverlay(kind, close);
  opened.push(unregister);
  return unregister;
}

afterEach(() => {
  for (const unregister of opened.splice(0)) {
    unregister();
  }
});

describe('the overlay registry', () => {
  it('opening a second overlay of a kind closes the first', () => {
    for (const kind of ['sheet', 'dialog', 'tooltip'] as const) {
      const first = vi.fn();
      const second = vi.fn();
      open(kind, first);
      expect(first, kind).not.toHaveBeenCalled();
      open(kind, second);
      expect(first, kind).toHaveBeenCalledTimes(1);
      expect(second, kind).not.toHaveBeenCalled();
      // A third closes the second and leaves the first, which is already closed, alone.
      open(kind);
      expect(second, kind).toHaveBeenCalledTimes(1);
      expect(first, kind).toHaveBeenCalledTimes(1);
    }
  });

  it('overlays of different kinds stay open together', () => {
    const sheet = vi.fn();
    const dialog = vi.fn();
    const tooltip = vi.fn();
    open('sheet', sheet);
    open('dialog', dialog);
    open('tooltip', tooltip);
    expect(sheet).not.toHaveBeenCalled();
    expect(dialog).not.toHaveBeenCalled();
    expect(tooltip).not.toHaveBeenCalled();
  });

  it('isModalOverlayOpen is true while a sheet or a dialog is open and false for a tooltip', () => {
    expect(isModalOverlayOpen()).toBe(false);
    const closeTooltip = open('tooltip');
    expect(isModalOverlayOpen()).toBe(false);
    const closeSheet = open('sheet');
    expect(isModalOverlayOpen()).toBe(true);
    closeSheet();
    expect(isModalOverlayOpen()).toBe(false);
    const closeDialog = open('dialog');
    expect(isModalOverlayOpen()).toBe(true);
    closeDialog();
    expect(isModalOverlayOpen()).toBe(false);
    closeTooltip();
  });

  it('unregistering removes it', () => {
    const first = vi.fn();
    const unregister = open('dialog', first);
    unregister();
    expect(isModalOverlayOpen()).toBe(false);
    // Nothing is open, so the next overlay closes nothing.
    open('dialog');
    expect(first).not.toHaveBeenCalled();
  });

  it('an overlay closed by a later one does not remove the later one', () => {
    const unregisterFirst = open('sheet');
    open('sheet');
    unregisterFirst();
    expect(isModalOverlayOpen()).toBe(true);
  });

  it('two overlays that share a close function stay apart', () => {
    const close = vi.fn();
    const unregisterFirst = open('dialog', close);
    open('dialog', close);
    expect(close).toHaveBeenCalledTimes(1);
    unregisterFirst();
    expect(isModalOverlayOpen()).toBe(true);
  });
});
