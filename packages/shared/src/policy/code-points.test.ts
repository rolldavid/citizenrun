import { describe, expect, it } from 'vitest';
import { codePointCount } from './code-points.ts';

describe('codePointCount', () => {
  it('counts an astral character once, not as two UTF-16 units', () => {
    const astral = String.fromCodePoint(0x1f600);
    expect(astral).toHaveLength(2);
    expect(codePointCount(astral)).toBe(1);
    expect(codePointCount(`ab${astral}c`)).toBe(4);
    expect(codePointCount('')).toBe(0);
  });
});
