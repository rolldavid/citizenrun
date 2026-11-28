import { describe, expect, it } from 'vitest';
import { LEGAL_VERSIONS } from './versions.ts';

describe('LEGAL_VERSIONS', () => {
  it('three versions, each the date its document took effect', () => {
    // The content policy and the privacy policy changed after the terms did.
    expect(LEGAL_VERSIONS).toEqual({
      terms: '2026-11-25',
      content_policy: '2026-11-27',
      privacy_policy: '2026-11-27',
    });
    for (const version of Object.values(LEGAL_VERSIONS)) {
      expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${version}T00:00:00.000Z`).toISOString().slice(0, 10)).toBe(version);
    }
  });
});
