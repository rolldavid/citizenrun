import { LEGAL_VERSIONS } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { buildSignupDetails } from './signup-details';

const STORE = { method: 'store_signal', sourceTier: 'confirmed' } as const;

describe('buildSignupDetails', () => {
  it('carries the three current legal versions', () => {
    expect(buildSignupDetails({ age: STORE, aiScreening: true, state: null }).agreements).toEqual({
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    });
  });

  it('omits the state when none was asked', () => {
    const details = buildSignupDetails({ age: STORE, aiScreening: true, state: null });
    expect(details).not.toHaveProperty('state');
    expect(details.age).toEqual(STORE);
    expect(details.aiScreening).toBe(true);
  });

  it('carries the state when picked', () => {
    expect(buildSignupDetails({ age: STORE, aiScreening: true, state: 'VT' }).state).toBe('VT');
  });

  it('carries null for "Not now"', () => {
    const details = buildSignupDetails({
      age: { method: 'none', sourceTier: null },
      aiScreening: null,
      state: null,
    });
    expect(details).toHaveProperty('aiScreening', null);
  });
});
