import { describe, expect, it } from 'vitest';
import { FONT_COVERAGE } from '@citizenrun/shared';
import fontMetrics from './font-metrics.json' with { type: 'json' };
import type { FontMetrics } from './layout-text.ts';

const METRICS = fontMetrics as FontMetrics;
const SANS = ['SpecialGothic-Regular', 'SpecialGothic-Medium', 'SpecialGothic-Bold'] as const;

/** The code points of a face's table at U+0020 and above, ascending. */
function tableCodePoints(face: keyof FontMetrics): number[] {
  return Object.keys(METRICS[face].advances)
    .map((ch) => ch.codePointAt(0) ?? -1)
    .filter((point) => point >= 0x20)
    .sort((a, b) => a - b);
}

function rangeCodePoints(ranges: readonly (readonly [number, number])[]): number[] {
  const points: number[] = [];
  for (const [first, last] of ranges) {
    for (let point = first; point <= last; point += 1) points.push(point);
  }
  return points.sort((a, b) => a - b);
}

describe('font metrics', () => {
  it('metrics table', () => {
    const bold = METRICS['SpecialGothic-Bold'].advances;
    expect([bold['0'], bold['1'], bold['$'], bold[',']]).toEqual([666, 373, 598, 261]);
    const medium = METRICS['SpecialGothic-Medium'].advances;
    expect([medium.n, medium[' '], medium['…']]).toEqual([547, 204, 737]);
    const regular = METRICS['SpecialGothic-Regular'].advances;
    expect([regular.n, regular[' ']]).toEqual([532, 220]);
    const mono = Object.values(METRICS['ChivoMono-Medium'].advances);
    expect(mono.length).toBeGreaterThan(95);
    expect(new Set(mono)).toEqual(new Set([600]));
    for (const face of SANS) {
      expect(METRICS[face].capHeight, face).toBe(710);
      expect(METRICS[face].unitsPerEm, face).toBe(1000);
    }
  });

  it('coverage matches FONT_COVERAGE', () => {
    const sans = rangeCodePoints(FONT_COVERAGE.sans);
    for (const face of SANS) {
      expect(tableCodePoints(face), face).toEqual(sans);
    }
    expect(tableCodePoints('ChivoMono-Medium')).toEqual(rangeCodePoints(FONT_COVERAGE.mono));
  });
});
