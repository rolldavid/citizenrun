import { useSyncExternalStore } from 'react';

import { storage } from '@/platform/storage';
import type { ThemeChoice } from '@/platform/storage';

export type BootState = 'starting' | 'ready';

const DEFAULT_THEME: ThemeChoice = 'system';

const listeners = new Set<() => void>();
const state: {
  boot: BootState;
  upgradeBlocked: boolean;
  minorEnded: boolean;
  storageHydrated: boolean;
} = { boot: 'starting', upgradeBlocked: false, minorEnded: false, storageHydrated: false };

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Calls listener after any change to the boot state, the two flags or the theme; answers the unsubscribe. */
export function subscribeSystemState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBoot(): BootState {
  return state.boot;
}

export function setBoot(boot: BootState): void {
  if (state.boot === boot) return;
  state.boot = boot;
  notify();
}

export function useBoot(): BootState {
  return useSyncExternalStore(subscribeSystemState, getBoot, getBoot);
}

/** The last /v1 answer was 426 and the page could not reload (00 section 6.12). */
export function isUpgradeBlocked(): boolean {
  return state.upgradeBlocked;
}

export function setUpgradeBlocked(blocked: boolean): void {
  if (state.upgradeBlocked === blocked) return;
  state.upgradeBlocked = blocked;
  notify();
}

export function useUpgradeBlocked(): boolean {
  return useSyncExternalStore(subscribeSystemState, isUpgradeBlocked, isUpgradeBlocked);
}

/** A cold-start minor signal ended the session on this device (D-531). */
export function isMinorEnded(): boolean {
  return state.minorEnded;
}

export function setMinorEnded(ended: boolean): void {
  if (state.minorEnded === ended) return;
  state.minorEnded = ended;
  notify();
}

export function useMinorEnded(): boolean {
  return useSyncExternalStore(subscribeSystemState, isMinorEnded, isMinorEnded);
}

/** storage.hydrate() has resolved, so storage.get may be called (PM-storage). */
export function markStorageHydrated(): void {
  if (state.storageHydrated) return;
  state.storageHydrated = true;
  notify();
}

export function getThemeChoice(): ThemeChoice {
  if (!state.storageHydrated) return DEFAULT_THEME;
  return storage.get('theme') ?? DEFAULT_THEME;
}

export function setThemeChoice(choice: ThemeChoice): void {
  storage.set('theme', choice);
  notify();
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribeSystemState, getThemeChoice, getThemeChoice);
}

/** Restores every default. Called by tests. */
export function resetSystemState(): void {
  state.boot = 'starting';
  state.upgradeBlocked = false;
  state.minorEnded = false;
  state.storageHydrated = false;
  notify();
}
