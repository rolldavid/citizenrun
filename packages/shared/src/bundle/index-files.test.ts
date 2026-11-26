import { describe, expect, it } from 'vitest';
import { AiMonthTotalSchema, BundlePointerSchema, LoaderInfoSchema } from './index-files.ts';

const AT = '2026-11-16T03:30:00.000Z';

describe('index files', () => {
  it('a pointer agrees with itself', () => {
    const pointer = {
      kind: 'full',
      version: '20261116T030000Z-full',
      manifest: 'bundles/20261116T030000Z-full/manifest.json',
      published_at: AT,
    };
    expect(BundlePointerSchema.safeParse(pointer).success).toBe(true);
    expect(BundlePointerSchema.safeParse({ ...pointer, kind: 'geometry' }).success).toBe(false);
    expect(
      BundlePointerSchema.safeParse({
        ...pointer,
        manifest: 'bundles/20261115T030000Z-full/manifest.json',
      }).success,
    ).toBe(false);
    expect(
      BundlePointerSchema.safeParse({
        ...pointer,
        version: 'sample-20261116T030000Z-full',
        manifest: 'bundles/sample-20261116T030000Z-full/manifest.json',
      }).success,
    ).toBe(false);
    expect(BundlePointerSchema.safeParse({ ...pointer, extra: 'x' }).success).toBe(false);
  });

  it('the loader file names this schema version', () => {
    const loader = { schema_version: 1, schema_revision: 0, updated_at: AT };
    expect(LoaderInfoSchema.safeParse(loader).success).toBe(true);
    expect(LoaderInfoSchema.safeParse({ ...loader, schema_version: 2 }).success).toBe(false);
    expect(LoaderInfoSchema.safeParse({ ...loader, schema_revision: -1 }).success).toBe(false);
  });

  it('the month total', () => {
    const total = { month: '2026-11', settled_micro_usd: 0, reserved_micro_usd: 0, updated_at: AT };
    expect(AiMonthTotalSchema.safeParse(total).success).toBe(true);
    expect(AiMonthTotalSchema.safeParse({ ...total, month: '2026-13' }).success).toBe(false);
    expect(AiMonthTotalSchema.safeParse({ ...total, settled_micro_usd: -1 }).success).toBe(false);
    expect(AiMonthTotalSchema.safeParse({ ...total, reserved_micro_usd: -1 }).success).toBe(false);
    expect(AiMonthTotalSchema.safeParse({ ...total, extra: 0 }).success).toBe(false);
  });
});
