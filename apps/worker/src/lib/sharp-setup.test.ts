import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SHARP_CONCURRENCY, configureSharp } from './sharp-setup.ts';

describe('configureSharp', () => {
  it('turns the cache off and caps concurrency', () => {
    // Start from other settings, so the case fails on a machine whose defaults happen to match.
    sharp.cache(true);
    sharp.concurrency(SHARP_CONCURRENCY + 1);
    expect(sharp.cache().items.max).toBeGreaterThan(0);
    configureSharp();
    const cache = sharp.cache();
    expect(cache.memory.max).toBe(0);
    expect(cache.files.max).toBe(0);
    expect(cache.items.max).toBe(0);
    expect(sharp.concurrency()).toBe(2);
    expect(SHARP_CONCURRENCY).toBe(2);
  });
});
