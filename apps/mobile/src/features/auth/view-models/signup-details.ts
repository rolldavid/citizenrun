import { LEGAL_VERSIONS, STATE_CODES } from '@citizenrun/shared';
import type { SignupDetails, StateCode } from '@citizenrun/shared';

function isStateCode(code: string): code is StateCode {
  return (STATE_CODES as readonly string[]).includes(code);
}

/** SCR-sign-in rule 2 (D-464): the answers a new account is created with. */
export function buildSignupDetails(input: {
  age: SignupDetails['age'];
  state: string | null;
}): SignupDetails {
  return {
    age: input.age,
    agreements: {
      termsVersion: LEGAL_VERSIONS.terms,
      contentPolicyVersion: LEGAL_VERSIONS.content_policy,
      privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
    },
    ...(input.state !== null && isStateCode(input.state) ? { state: input.state } : {}),
  };
}
