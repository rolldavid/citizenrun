import { describe, expect, it } from 'vitest';
import { STATE_CODES } from '@citizenrun/shared';
import { PIPELINE_STATES, UnknownStateError, stateByCode, stateByFips } from './states.ts';

describe('the pipeline states', () => {
  it('has 51 rows ordered by FIPS', () => {
    expect(PIPELINE_STATES).toHaveLength(51);
    const fips = PIPELINE_STATES.map((row) => row.fips);
    expect(fips).toEqual([...fips].sort());
    expect(fips.every((code) => /^\d{2}$/.test(code))).toBe(true);
  });

  it('codes and FIPS are unique', () => {
    expect(new Set(PIPELINE_STATES.map((row) => row.code)).size).toBe(51);
    expect(new Set(PIPELINE_STATES.map((row) => row.fips)).size).toBe(51);
  });

  it('every code is a shared state code', () => {
    const known: ReadonlySet<string> = new Set(STATE_CODES);
    for (const row of PIPELINE_STATES) {
      expect(known.has(row.code)).toBe(true);
    }
  });

  it('holds no territory', () => {
    const codes = PIPELINE_STATES.map((row) => row.code);
    for (const territory of ['PR', 'GU', 'VI', 'AS', 'MP']) {
      expect(codes).not.toContain(territory);
    }
  });

  it('looks states up', () => {
    expect(stateByFips('11')?.code).toBe('DC');
    expect(stateByFips('37')?.name).toBe('North Carolina');
    expect(stateByFips('72')).toBeNull();
    expect(stateByCode('WA').fips).toBe('53');
    expect(() => stateByCode('XX')).toThrow(UnknownStateError);
  });
});
