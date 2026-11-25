import { describe, expect, it } from 'vitest';
import { LEGAL_VERSIONS } from './versions.ts';

describe('LEGAL_VERSIONS', () => {
  it('four versions, one date', () => {
    expect(Object.keys(LEGAL_VERSIONS).sort()).toEqual([
      'ai_screening',
      'content_policy',
      'privacy_policy',
      'terms',
    ]);
    for (const version of Object.values(LEGAL_VERSIONS)) {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(version).toBe(LEGAL_VERSIONS.terms);
    }
    expect(new Date(`${LEGAL_VERSIONS.terms}T00:00:00.000Z`).toISOString().slice(0, 10)).toBe(
      LEGAL_VERSIONS.terms,
    );
  });
});
