import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import { evaluateFee, evaluateSignatures } from './evaluate.ts';
import type { OfficeRef } from './types.ts';

function office(payAnnualCents: number | null): OfficeRef {
  return {
    state: 'ZZ',
    templateKey: 'county-commission',
    officeTypeId: 'county-commission',
    jurisdictionKind: 'county',
    countyGeoid: null,
    partisan: null,
    schedule: 'zz_county_general',
    trackSet: 'zz_filing',
    staggerGroup: null,
    termYears: null,
    payAnnualCents,
    population: null,
  };
}

describe('the evaluators', () => {
  it('fees', async () => {
    await eachZone(() => {
      expect(evaluateFee({ kind: 'fixed', cents: 5_000 }, office(null))).toBe(5_000);
      expect(evaluateFee({ kind: 'percent_of_annual_pay', percent: 1 }, office(5_294_100))).toBe(
        52_941,
      );
      expect(evaluateFee({ kind: 'percent_of_annual_pay', percent: 2.5 }, office(1_000_001))).toBe(
        25_000,
      );
      // Half a cent rounds away from zero: 1 percent of 50 cents is 0.5.
      expect(evaluateFee({ kind: 'percent_of_annual_pay', percent: 1 }, office(50))).toBe(1);
      expect(evaluateFee({ kind: 'percent_of_annual_pay', percent: 1 }, office(null))).toBeNull();
      expect(evaluateFee({ kind: 'none' }, office(5_294_100))).toBe(0);
    });
  });

  it('signatures', async () => {
    await eachZone(() => {
      const inputs = { office: office(null) };
      expect(evaluateSignatures({ kind: 'fixed', count: 100 }, inputs)).toBe(100);
      expect(evaluateSignatures({ kind: 'range', min: 200, max: 400 }, inputs)).toBe(200);
      expect(evaluateSignatures({ kind: 'percent_of_registered', percent: 2 }, inputs)).toBeNull();
      expect(
        evaluateSignatures(
          { kind: 'percent_of_votes', percent: 5, base: 'last_same_office' },
          inputs,
        ),
      ).toBeNull();
      expect(
        evaluateSignatures({ kind: 'percent_of_votes', percent: 5, base: 'last_governor' }, inputs),
      ).toBeNull();
      expect(evaluateSignatures({ kind: 'none' }, inputs)).toBe(0);
    });
  });
});
