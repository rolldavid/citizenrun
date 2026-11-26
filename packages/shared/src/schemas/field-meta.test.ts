import { describe, expect, it } from 'vitest';
import { fieldMetaEntries, toFieldMeta } from './field-meta.ts';

const ROW = {
  source_url: 'https://example.test/fixture-ordinance',
  quote: 'Fixture quote of the ordinance.',
  confidence: 'high',
  checked_at: '2027-03-05T17:00:00.000Z',
};

const META = {
  sourceUrl: 'https://example.test/fixture-ordinance',
  quote: 'Fixture quote of the ordinance.',
  confidence: 'high',
  checkedAt: '2027-03-05T17:00:00.000Z',
  ruleCitation: null,
};

describe('toFieldMeta', () => {
  it('maps the stored keys', () => {
    expect(
      toFieldMeta({
        ...ROW,
        rule_citation: 'Fixture Code § 12-3',
        population_source: 'acs5',
        population_year: 2023,
      }),
    ).toEqual({ ...META, ruleCitation: 'Fixture Code § 12-3' });
  });

  it('an absent rule citation is null', () => {
    expect(toFieldMeta(ROW)).toEqual(META);
  });

  it('an offset instant does not parse', () => {
    const offset = { ...ROW, checked_at: '2027-03-05T17:00:00+00:00' };
    expect(toFieldMeta(offset)).toBeNull();
    expect(
      fieldMetaEntries({ pay_annual_cents: offset }, [
        ['payAnnualCents', 'pay_annual_cents', 1_200_000],
      ]),
    ).toEqual({ entries: {}, invalid: ['pay_annual_cents'] });
  });

  it('a stored entry that does not parse gives null', () => {
    expect(toFieldMeta(null)).toBeNull();
    expect(toFieldMeta('high')).toBeNull();
    expect(toFieldMeta({ ...ROW, source_url: null })).toBeNull();
    expect(toFieldMeta({ ...ROW, source_url: 'http://example.test/plain' })).toBeNull();
    expect(toFieldMeta({ ...ROW, extra: true })).toBeNull();
  });
});

describe('fieldMetaEntries', () => {
  it('gives one entry per sourced non-null value, under its wire key', () => {
    expect(
      fieldMetaEntries({ pay_annual_cents: ROW, filing_fee_cents: { ...ROW, confidence: 'low' } }, [
        ['payAnnualCents', 'pay_annual_cents', 1_200_000],
        ['filingFeeCents', 'filing_fee_cents', 0],
      ]),
    ).toEqual({
      entries: { payAnnualCents: META, filingFeeCents: { ...META, confidence: 'low' } },
      invalid: [],
    });
  });

  it('a null value never gets an entry', () => {
    expect(
      fieldMetaEntries({ pay_annual_cents: ROW }, [['payAnnualCents', 'pay_annual_cents', null]]),
    ).toEqual({ entries: {}, invalid: [] });
  });

  it('a missing stored entry gives no entry', () => {
    expect(
      fieldMetaEntries({ pay_annual_cents: ROW }, [['hoursPerWeek', 'hours_per_week', 10]]),
    ).toEqual({ entries: {}, invalid: [] });
  });

  it('an invalid stored entry is named', () => {
    expect(
      fieldMetaEntries({ pay_annual_cents: ROW, hours_per_week: { confidence: 'high' } }, [
        ['payAnnualCents', 'pay_annual_cents', 1_200_000],
        ['hoursPerWeek', 'hours_per_week', 10],
      ]),
    ).toEqual({ entries: { payAnnualCents: META }, invalid: ['hours_per_week'] });
  });

  it('a stored value that is not an object gives nothing', () => {
    for (const stored of [null, undefined, 'x', 3, [ROW]]) {
      expect(fieldMetaEntries(stored, [['payAnnualCents', 'pay_annual_cents', 1]])).toEqual({
        entries: {},
        invalid: [],
      });
    }
  });

  it('a stored key inherited from the prototype is not read', () => {
    expect(fieldMetaEntries({}, [['payAnnualCents', 'toString', 1]])).toEqual({
      entries: {},
      invalid: [],
    });
  });
});
