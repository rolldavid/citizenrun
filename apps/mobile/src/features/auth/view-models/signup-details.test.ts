import { LEGAL_VERSIONS } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { buildSignupDetails } from './signup-details';

const STORE = { method: 'store_signal', sourceTier: 'confirmed' } as const;

describe('buildSignupDetails', () => {
  it('carries the three current legal versions', () => {
    expect(buildSignupDetails({ age: STORE, state: null }).agreements).toEqual({
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    });
  });

  it('omits the state when none was asked', () => {
    const details = buildSignupDetails({ age: STORE, state: null });
    expect(details).not.toHaveProperty('state');
    expect(details.age).toEqual(STORE);
  });

  it('carries the state when picked', () => {
    expect(buildSignupDetails({ age: STORE, state: 'VT' }).state).toBe('VT');
  });

  it('carries the age record, the agreements and no AI-screening answer', () => {
    const details = buildSignupDetails({
      age: { method: 'none', sourceTier: null },
      state: null,
    });
    expect(Object.keys(details).sort()).toEqual(['age', 'agreements']);
    expect(Object.keys(buildSignupDetails({ age: STORE, state: 'VT' })).sort()).toEqual([
      'age',
      'agreements',
      'state',
    ]);
  });
});
