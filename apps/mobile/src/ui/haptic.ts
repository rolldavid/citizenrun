import { assertNever } from '@citizenrun/shared';

import { haptics } from '@/platform/haptics';

export type HapticName = 'selection' | 'light' | 'medium' | 'success' | 'warning';

/** The shortest time between two haptics, in milliseconds. */
const HAPTIC_MIN_GAP_MS = 100;

/** When the last haptic played, as Date.now() gave it; null before the first. */
let lastPlayedAt: number | null = null;

function play(name: HapticName): void {
  switch (name) {
    case 'selection':
      haptics.selection();
      return;
    case 'light':
    case 'medium':
      haptics.impact(name);
      return;
    case 'success':
    case 'warning':
      haptics.notify(name);
      return;
    default:
      assertNever(name);
  }
}

/**
 * Plays a haptic through the haptics platform module (DS-haptics). A call made less than
 * HAPTIC_MIN_GAP_MS after the last one that played is dropped, and a dropped call does not count as
 * the last one.
 */
export function playHaptic(name: HapticName): void {
  const now = Date.now();
  if (lastPlayedAt !== null) {
    // A clock set back gives a negative gap, which says nothing about the time passed: play.
    const gap = now - lastPlayedAt;
    if (gap >= 0 && gap < HAPTIC_MIN_GAP_MS) return;
  }
  lastPlayedAt = now;
  play(name);
}
