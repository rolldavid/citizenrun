import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GB,
  COST_LINES,
  STORAGE_CENTS_PER_GB_MONTH,
  STORAGE_THRESHOLD_CENTS,
  storageLine,
  storageProjectionCents,
} from './cost-lines.ts';

describe('the storage cost line', () => {
  it('storage just under and just over its threshold', () => {
    // 666,666,666,666 bytes at 1.5 cents per GB is 999.999999999 cents, rounded up to 1,000.
    expect(storageProjectionCents(666_666_666_666)).toBe(1_000);
    expect(storageProjectionCents(666_666_666_666) > STORAGE_THRESHOLD_CENTS).toBe(false);
    expect(storageProjectionCents(666_666_666_667)).toBe(1_001);
    expect(storageProjectionCents(666_666_666_667) > STORAGE_THRESHOLD_CENTS).toBe(true);
  });

  it('zero bytes project zero', () => {
    expect(storageProjectionCents(0)).toBe(0);
  });

  it('one byte projects one cent', () => {
    expect(storageProjectionCents(1)).toBe(1);
  });

  it('the integer formula charges the stated price', () => {
    expect(storageProjectionCents(2 * BYTES_PER_GB)).toBe(2 * STORAGE_CENTS_PER_GB_MONTH);
    expect(storageProjectionCents(100 * BYTES_PER_GB)).toBe(150);
    expect(STORAGE_THRESHOLD_CENTS).toBe(1_000);
  });

  it('the storage line is the only line', () => {
    expect(COST_LINES).toEqual([storageLine]);
  });
});
