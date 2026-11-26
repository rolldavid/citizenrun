import { describe, expect, it } from 'vitest';
import { civicId } from './civic-id.ts';

describe('civicId', () => {
  it('matches the four test vectors', () => {
    expect(civicId('districts', 'tiger:place:0820000')).toBe(
      'f39e145e-0fab-5ce1-927d-521f2faf3051',
    );
    expect(civicId('districts', 'tiger:sldl:25019')).toBe('9c7be58f-af74-5905-996d-4b38291686a1');
    expect(civicId('districts', 'county_approx:08001')).toBe(
      '4c37dfd1-fe7b-5686-b577-896c11fc0625',
    );
    expect(civicId('jurisdictions', 'census:123456')).toBe('12cb6d8d-d344-54ec-b091-c35e7eb6c9e0');
  });

  it('the same inputs give the same id', () => {
    expect(civicId('offices', 'zz-fixture-office')).toBe(civicId('offices', 'zz-fixture-office'));
  });

  it('a key differing only in case gives a different id', () => {
    expect(civicId('districts', 'tiger:place:0820000')).not.toBe(
      civicId('districts', 'TIGER:place:0820000'),
    );
  });

  it('the table is part of the id', () => {
    expect(civicId('offices', 'tiger:place:0820000')).not.toBe(
      civicId('districts', 'tiger:place:0820000'),
    );
  });

  it('the key is used exactly as given', () => {
    expect(civicId('districts', ' tiger:place:0820000')).not.toBe(
      civicId('districts', 'tiger:place:0820000'),
    );
  });

  it('the result is a version 5 uuid', () => {
    const id = civicId('people', 'bioguide:Z000001');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
