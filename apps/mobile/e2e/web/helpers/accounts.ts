import {
  EmailStartResultSchema,
  ErrorEnvelopeSchema,
  LEGAL_VERSIONS,
  MeSchema,
} from '@citizenrun/shared';
import type {
  SetHandleBody,
  SetIssuesBody,
  SkipOnboardingStepBody,
  StartEmailSignInBody,
  VerifyEmailSignInBody,
} from '@citizenrun/shared';
import { expect } from '@playwright/test';
import type { APIResponse, BrowserContext } from '@playwright/test';

import { apiHeaders, operationPath } from './api.ts';
import { readCode } from './mailbox.ts';

/** The issues an account made through the API holds: three picks, the first starred. */
const ISSUES: SetIssuesBody['issues'] = [
  { issueId: 'rent-housing', starred: true },
  { issueId: 'climate', starred: false },
  { issueId: 'schools', starred: false },
];

/** The error code of a failed answer, or the status of one that is not an error envelope. */
async function errorCodeOf(response: APIResponse): Promise<string> {
  const parsed = ErrorEnvelopeSchema.safeParse(await response.json());
  return parsed.success ? parsed.data.error.code : `status ${String(response.status())}`;
}

/** Fails, naming the step and the status, unless the answer is 200; never prints the body. */
function expectOk(response: APIResponse, step: string): void {
  expect(response.status(), step).toBe(200);
}

/**
 * Signs a new person up through the API as the web app would: the email code, the sign-up details
 * (a self-declared adult, the current agreements, AI screening allowed), then every onboarding step
 * (photo skipped, the handle, three issues, location skipped). The session cookie lands in the
 * context, so its pages are signed in. Nothing typed is printed.
 */
export async function signUpThroughApi(
  context: BrowserContext,
  input: { email: string; handle: string; address: string },
): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());
  const headers = { ...(await apiHeaders(page)), 'x-real-ip': input.address };
  const { request } = context;

  const startBody: StartEmailSignInBody = { email: input.email };
  const started = await request.post(operationPath('startEmailSignIn'), {
    headers,
    data: startBody,
  });
  expectOk(started, 'E-AUTH-01 starts the sign-in');
  const { pendingToken } = EmailStartResultSchema.parse(await started.json());

  const code = await readCode(request, input.email);

  // A new person has no session until the request is repeated with the sign-up details.
  const bare: VerifyEmailSignInBody = { pendingToken, code, intent: 'sign_in' };
  const asked = await request.post(operationPath('verifyEmailSignIn'), { headers, data: bare });
  expect(await errorCodeOf(asked), 'E-AUTH-02 asks for the sign-up details').toBe(
    'signup_details_required',
  );

  const withDetails: VerifyEmailSignInBody = {
    pendingToken,
    code,
    intent: 'sign_in',
    signup: {
      age: { method: 'self_declared', sourceTier: 'self' },
      agreements: {
        termsVersion: LEGAL_VERSIONS.terms,
        contentPolicyVersion: LEGAL_VERSIONS.content_policy,
        privacyPolicyVersion: LEGAL_VERSIONS.privacy_policy,
      },
      aiScreening: true,
    },
  };
  expectOk(
    await request.post(operationPath('verifyEmailSignIn'), { headers, data: withDetails }),
    'E-AUTH-02 creates the account',
  );

  const skipPhoto: SkipOnboardingStepBody = { step: 'photo' };
  expectOk(
    await request.post(operationPath('skipOnboardingStep'), { headers, data: skipPhoto }),
    'E-ME-10 skips the photo',
  );
  const handle: SetHandleBody = { handle: input.handle };
  expectOk(
    await request.put(operationPath('setHandle'), { headers, data: handle }),
    'E-ME-08 sets the handle',
  );
  const issues: SetIssuesBody = { issues: ISSUES };
  expectOk(
    await request.put(operationPath('setIssues'), { headers, data: issues }),
    'E-ME-09 sets the issues',
  );
  const skipLocation: SkipOnboardingStepBody = { step: 'location' };
  const done = await request.post(operationPath('skipOnboardingStep'), {
    headers,
    data: skipLocation,
  });
  expectOk(done, 'E-ME-10 skips the location');
  expect(MeSchema.parse(await done.json()).onboardingStep, 'onboarding is done').toBe('done');
}
