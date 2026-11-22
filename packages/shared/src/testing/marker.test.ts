import { describe, expect, it } from 'vitest';
import { marker } from './marker.ts';

describe('marker', () => {
  it('returns the run marker', () => {
    expect(marker()).toMatch(/^PRIVMARK[0-9a-f]{12}$/);
    expect(marker()).toBe(marker());
  });
});
