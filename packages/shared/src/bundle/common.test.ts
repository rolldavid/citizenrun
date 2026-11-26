import { describe, expect, it } from 'vitest';
import {
  BUNDLE_SCHEMA_REVISION,
  BUNDLE_SCHEMA_VERSION,
  FieldMetaMapSchema,
  FieldMetaRowSchema,
  IsoInstantSchema,
  LOADER_SCHEMA_REVISION,
  LocalTimeSchema,
  SafeUrlSchema,
  text,
} from './common.ts';

const CHECKED_AT = '2026-11-16T03:00:00.000Z';

describe('bundle common schemas', () => {
  it('schema constants', () => {
    expect(BUNDLE_SCHEMA_VERSION).toBe(1);
    expect(BUNDLE_SCHEMA_REVISION).toBe(0);
    expect(LOADER_SCHEMA_REVISION).toBe(0);
  });

  it('field proof needs a source above low', () => {
    const full = {
      source_url: 'https://example.test/fixture-source',
      quote: 'Fixture quote.',
      checked_at: CHECKED_AT,
    };
    for (const confidence of ['high', 'medium'] as const) {
      expect(FieldMetaRowSchema.safeParse({ ...full, confidence }).success).toBe(true);
      expect(FieldMetaRowSchema.safeParse({ ...full, confidence, source_url: null }).success).toBe(
        false,
      );
      expect(FieldMetaRowSchema.safeParse({ ...full, confidence, quote: null }).success).toBe(
        false,
      );
    }
    expect(
      FieldMetaRowSchema.safeParse({
        source_url: null,
        quote: null,
        confidence: 'low',
        checked_at: CHECKED_AT,
      }).success,
    ).toBe(true);
    expect(FieldMetaRowSchema.safeParse({ ...full, confidence: 'high', extra: 'x' }).success).toBe(
      false,
    );
    expect(
      FieldMetaRowSchema.safeParse({
        ...full,
        confidence: 'high',
        rule_citation: 'Fixture Code 1-1',
        population_source: 'acs5',
        population_year: 2023,
      }).success,
    ).toBe(true);
  });

  it('field proof keys are snake case', () => {
    const entry = { source_url: null, quote: null, confidence: 'low', checked_at: CHECKED_AT };
    expect(FieldMetaMapSchema.safeParse({ pay_annual_cents: entry }).success).toBe(true);
    expect(FieldMetaMapSchema.safeParse({ payAnnualCents: entry }).success).toBe(false);
  });

  it('safe links are https only', () => {
    for (const bad of [
      'http://example.test',
      'javascript:alert(1)',
      'data:text/html,x',
      'https://user:pass@example.test',
    ]) {
      expect(SafeUrlSchema.safeParse(bad).success).toBe(false);
    }
    const prefix = 'https://example.test/';
    const longest = prefix + 'a'.repeat(2048 - prefix.length);
    expect(longest).toHaveLength(2048);
    expect(SafeUrlSchema.safeParse(longest).success).toBe(true);
    expect(SafeUrlSchema.safeParse(`${longest}a`).success).toBe(false);
  });

  it('text refuses control characters and empty strings', () => {
    const schema = text(10);
    expect(schema.safeParse('Fixture').success).toBe(true);
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse('a\u0000b').success).toBe(false);
    expect(schema.safeParse('a\nb').success).toBe(false);
    expect(schema.safeParse('a\u001fb').success).toBe(false);
    expect(schema.safeParse('a\u007fb').success).toBe(false);
    expect(schema.safeParse('a'.repeat(11)).success).toBe(false);
  });

  it('instants carry milliseconds and Z', () => {
    expect(IsoInstantSchema.safeParse('2027-03-05T22:00:00.000Z').success).toBe(true);
    expect(IsoInstantSchema.safeParse('2027-03-05T22:00:00Z').success).toBe(false);
    expect(IsoInstantSchema.safeParse('2027-03-05T22:00:00.000+00:00').success).toBe(false);
  });

  it('local times are 24-hour', () => {
    expect(LocalTimeSchema.safeParse('00:00').success).toBe(true);
    expect(LocalTimeSchema.safeParse('23:59').success).toBe(true);
    expect(LocalTimeSchema.safeParse('24:00').success).toBe(false);
    expect(LocalTimeSchema.safeParse('7:00').success).toBe(false);
  });
});
