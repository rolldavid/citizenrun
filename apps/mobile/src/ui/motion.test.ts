import { motion, MOTION_SPECS, resolveMotion } from '@citizenrun/shared';
import type { MotionId } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

const MOTION_IDS: readonly MotionId[] = [
  'press',
  'like',
  'follow',
  'run',
  'cardToPage',
  'gridToPost',
  'meters',
  'deadlineRing',
  'loading',
  'pullToRefresh',
  'sheet',
  'carousel',
  'map',
  'districtReveal',
  'messages',
  'toast',
];

describe('motion presets', () => {
  it('every motion id has a preset', () => {
    expect(MOTION_IDS).toHaveLength(16);
    expect(Object.keys(MOTION_SPECS).sort()).toEqual([...MOTION_IDS].sort());
  });

  it('motion presets use names', () => {
    expect(MOTION_SPECS.press.durationMs).toBe(90);
    expect(MOTION_SPECS.follow.durationMs).toBe(180);
    expect(MOTION_SPECS.sheet.durationMs).toBe(240);
    expect(MOTION_SPECS.cardToPage.durationMs).toBe(280);
    expect(MOTION_SPECS.loading.durationMs).toBe(1200);
    expect(motion.duration.press).toBe(90);
    expect(motion.duration.pulse).toBe(1200);
    expect(motion.spring).toEqual({
      standard: { damping: 18, stiffness: 220, mass: 1 },
      snap: { damping: 26, stiffness: 420, mass: 1 },
      stamp: { damping: 44, stiffness: 1000, mass: 1 },
    });
  });

  it('reduced motion turns every preset into a 120 ms fade', () => {
    for (const id of MOTION_IDS) {
      expect(resolveMotion(id, true), id).toEqual({
        animates: ['opacity'],
        spring: null,
        durationMs: 120,
        staggerMs: null,
        loops: false,
      });
      expect(resolveMotion(id, false), id).toBe(MOTION_SPECS[id]);
    }
  });

  it('animations touch only transform and opacity', () => {
    for (const id of MOTION_IDS) {
      for (const property of MOTION_SPECS[id].animates) {
        expect(['transform', 'opacity'], id).toContain(property);
      }
    }
  });

  it('only the loading pulse loops', () => {
    expect(MOTION_IDS.filter((id) => MOTION_SPECS[id].loops)).toEqual(['loading']);
  });
});
