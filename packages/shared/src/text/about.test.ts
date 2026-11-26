import { describe, expect, it } from 'vitest';
import { isAbout } from './about.ts';

describe('isAbout', () => {
  it('a null value is never about, whatever the meta', () => {
    expect(isAbout(null, { confidence: 'low' }, true)).toBe(false);
    expect(isAbout(null, { confidence: 'high' }, null)).toBe(false);
    expect(isAbout(null, null, null)).toBe(false);
  });

  it('low confidence gives about', () => {
    expect(isAbout(2_100, { confidence: 'low' }, null)).toBe(true);
    expect(isAbout(2_100, { confidence: 'low' }, false)).toBe(true);
  });

  it('medium and high confidence do not', () => {
    expect(isAbout(2_100, { confidence: 'medium' }, null)).toBe(false);
    expect(isAbout(2_100, { confidence: 'high' }, false)).toBe(false);
  });

  it('an estimate is about even at high confidence', () => {
    expect(isAbout(2_100, { confidence: 'high' }, true)).toBe(true);
    expect(isAbout(2_100, null, true)).toBe(true);
  });

  it('a null meta with estimated null is not about', () => {
    expect(isAbout(2_100, null, null)).toBe(false);
  });

  it('a known zero is a known value', () => {
    expect(isAbout(0, { confidence: 'low' }, null)).toBe(true);
  });
});
