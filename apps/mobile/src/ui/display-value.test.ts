import { formatMoney, formatNumber } from '@citizenrun/shared';
import type { FieldMeta } from '@citizenrun/shared';
import { describe, expect, it, vi } from 'vitest';

import { toDisplayValue } from './display-value';

/** A fixture proof at the given confidence; a low proof may have no source. */
function proof(confidence: FieldMeta['confidence']): FieldMeta {
  return {
    sourceUrl: confidence === 'low' ? null : 'https://wrencounty.example/budget',
    quote: confidence === 'low' ? null : 'Fixture quote.',
    confidence,
    checkedAt: '2026-01-15T00:00:00.000Z',
    ruleCitation: null,
  };
}

const money = (cents: number): string => formatMoney(cents, 'en-US');
const count = (value: number): string => formatNumber(value, 'en-US');

describe('toDisplayValue', () => {
  it('a null value is not known yet', () => {
    const format = vi.fn(money);
    expect(toDisplayValue({ value: null, meta: null }, format)).toEqual({
      text: null,
      about: false,
    });
    // Not an estimate either: there is nothing to be about.
    expect(toDisplayValue({ value: null, meta: proof('low') }, format, true)).toEqual({
      text: null,
      about: false,
    });
    expect(format).not.toHaveBeenCalled();
  });

  it('a low proof is about', () => {
    expect(toDisplayValue({ value: 5290000, meta: proof('low') }, money)).toEqual({
      text: '$52,900',
      about: true,
    });
  });

  it('an estimate is about', () => {
    expect(toDisplayValue({ value: 2100, meta: proof('high') }, count, true)).toEqual({
      text: '2,100',
      about: true,
    });
    expect(toDisplayValue({ value: 2100, meta: proof('high') }, count, false).about).toBe(false);
    expect(toDisplayValue({ value: 2100, meta: proof('high') }, count, null).about).toBe(false);
  });

  it('a medium proof is plain', () => {
    expect(toDisplayValue({ value: 5290000, meta: proof('medium') }, money)).toEqual({
      text: '$52,900',
      about: false,
    });
  });

  it('no proof and not estimated is plain', () => {
    expect(toDisplayValue({ value: 4, meta: null }, String)).toEqual({ text: '4', about: false });
  });
});
