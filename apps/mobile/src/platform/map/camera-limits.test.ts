import { describe, expect, it } from 'vitest';

import { applyCameraLimits } from './camera-limits';
import type { CameraLimitTarget } from './camera-limits';

type Call = readonly [string, unknown];

function target(throwing: ReadonlySet<string> = new Set()): {
  map: CameraLimitTarget;
  calls: Call[];
} {
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (value: unknown): void => {
      calls.push([name, value]);
      if (throwing.has(name)) throw new Error(`${name} refused`);
    };
  return {
    map: {
      setMaxBounds: record('setMaxBounds'),
      setMinZoom: record('setMinZoom'),
      setMaxZoom: record('setMaxZoom'),
    },
    calls,
  };
}

describe('applyCameraLimits', () => {
  it('sets the bounds and both zoom limits', () => {
    const { map, calls } = target();
    expect(applyCameraLimits(map, [-125, 24, -66, 50], 3, 16)).toBe(0);
    expect(calls).toEqual([
      ['setMaxBounds', [-125, 24, -66, 50]],
      ['setMinZoom', 3],
      ['setMaxZoom', 16],
    ]);
  });

  it('clears the bounds with null', () => {
    const { map, calls } = target();
    applyCameraLimits(map, null, 0, 22);
    expect(calls[0]).toEqual(['setMaxBounds', null]);
  });

  it('a setter that throws does not skip the ones after it', () => {
    const { map, calls } = target(new Set(['setMaxBounds', 'setMinZoom']));
    expect(applyCameraLimits(map, [-125, 24, -66, 50], 3, 16)).toBe(2);
    expect(calls.map(([name]) => name)).toEqual(['setMaxBounds', 'setMinZoom', 'setMaxZoom']);
  });
});
