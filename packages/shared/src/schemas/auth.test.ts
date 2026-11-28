import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import * as auth from './auth.ts';
import {
  AppleCallbackFormSchema,
  AppleHandoffBodySchema,
  EmailAddressSchema,
  SessionInfoSchema,
  SignInWithAppleBodySchema,
  SignInIntentSchema,
  SignInWithGoogleBodySchema,
  SignupDetailsSchema,
  StartEmailSignInBodySchema,
  VerifyEmailSignInBodySchema,
} from './auth.ts';

const TOKEN = 'A'.repeat(21) + '-_' + 'z9'.repeat(10);

const SIGNUP = {
  age: { method: 'none', sourceTier: null },
  agreements: {
    termsVersion: '2027-01-01',
    contentPolicyVersion: '2027-01-01',
    privacyPolicyVersion: '2027-01-01',
  },
  aiScreening: null,
};

function fieldIssues(result: z.ZodSafeParseResult<unknown>) {
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    params: 'params' in issue ? issue.params : undefined,
  }));
}

describe('StartEmailSignInBody', () => {
  it('StartEmailSignInBody trims and lower-cases', () => {
    expect(StartEmailSignInBodySchema.parse({ email: '  Person@Example.TEST ' })).toEqual({
      email: 'person@example.test',
    });
    expect(fieldIssues(StartEmailSignInBodySchema.safeParse({ email: 'not-an-email' }))).toEqual([
      { path: 'email', code: 'invalid_format', params: undefined },
    ]);
  });

  it('an email is at most 254 characters', () => {
    const longest = `${'a'.repeat(64)}@${'b'.repeat(176)}.example.test`;
    expect(longest).toHaveLength(254);
    expect(StartEmailSignInBodySchema.safeParse({ email: longest }).success).toBe(true);
    expect(StartEmailSignInBodySchema.safeParse({ email: `a${longest}` }).success).toBe(false);
  });

  it('keeps a pending token for a resend', () => {
    expect(
      StartEmailSignInBodySchema.parse({ email: 'a@example.test', pendingToken: TOKEN }),
    ).toEqual({ email: 'a@example.test', pendingToken: TOKEN });
  });
});

describe('tokens', () => {
  it('pending tokens and nonces are 43 characters of base64url', () => {
    expect(TOKEN).toHaveLength(43);
    const bad = [TOKEN.slice(1), `${TOKEN}A`, `${TOKEN.slice(1)}=`, `${TOKEN.slice(1)}+`];
    for (const pendingToken of [TOKEN, ...bad]) {
      const verify = VerifyEmailSignInBodySchema.safeParse({ pendingToken, code: '123456' });
      expect(verify.success).toBe(pendingToken === TOKEN);
      const start = StartEmailSignInBodySchema.safeParse({ email: 'a@example.test', pendingToken });
      expect(start.success).toBe(pendingToken === TOKEN);
    }
    for (const nonce of [TOKEN, ...bad]) {
      const google = SignInWithGoogleBodySchema.safeParse({ idToken: 'token', nonce });
      expect(google.success).toBe(nonce === TOKEN);
      const handoff = AppleHandoffBodySchema.safeParse({ code: TOKEN, nonce });
      expect(handoff.success).toBe(nonce === TOKEN);
    }
  });

  it('a hand-off without a nonce fails', () => {
    expect(AppleHandoffBodySchema.safeParse({ code: TOKEN }).success).toBe(false);
  });
});

describe('VerifyEmailSignInBody', () => {
  it('VerifyEmailSignInBody defaults intent to sign_in', () => {
    expect(VerifyEmailSignInBodySchema.parse({ pendingToken: TOKEN, code: '012345' })).toEqual({
      pendingToken: TOKEN,
      code: '012345',
      intent: 'sign_in',
    });
    expect(
      VerifyEmailSignInBodySchema.parse({
        pendingToken: TOKEN,
        code: '012345',
        intent: 'add_email',
      }).intent,
    ).toBe('add_email');
  });

  it('a five-digit code fails', () => {
    expect(
      fieldIssues(VerifyEmailSignInBodySchema.safeParse({ pendingToken: TOKEN, code: '12345' })),
    ).toEqual([{ path: 'code', code: 'invalid_format', params: undefined }]);
    expect(
      VerifyEmailSignInBodySchema.safeParse({ pendingToken: TOKEN, code: '12345a' }).success,
    ).toBe(false);
  });
});

describe('SignupDetails', () => {
  it('SignupDetails pairs method and tier', () => {
    for (const age of [
      { method: 'store_signal', sourceTier: null },
      { method: 'none', sourceTier: 'confirmed' },
      { method: 'none', sourceTier: 'declared' },
    ]) {
      expect(fieldIssues(SignupDetailsSchema.safeParse({ ...SIGNUP, age }))).toEqual([
        { path: 'age.sourceTier', code: 'custom', params: { code: 'invalid_value' } },
      ]);
    }
    for (const age of [
      { method: 'store_signal', sourceTier: 'confirmed' },
      { method: 'store_signal', sourceTier: 'declared' },
      { method: 'none', sourceTier: null },
    ]) {
      expect(SignupDetailsSchema.safeParse({ ...SIGNUP, age }).success).toBe(true);
    }
  });

  it('SignupDetails takes no self-declared age', () => {
    expect(
      fieldIssues(
        SignupDetailsSchema.safeParse({
          ...SIGNUP,
          age: { method: 'self_declared', sourceTier: 'self' },
        }),
      ).map((issue) => issue.path),
    ).toEqual(['age.method', 'age.sourceTier']);
    expect(
      SignupDetailsSchema.safeParse({ ...SIGNUP, age: { method: 'none', sourceTier: 'self' } })
        .success,
    ).toBe(false);
    expect(SignupDetailsSchema.safeParse({ ...SIGNUP, age: { method: 'none' } }).success).toBe(
      false,
    );
  });

  it('SignupDetails state is a state code or absent', () => {
    expect(SignupDetailsSchema.safeParse({ ...SIGNUP, state: 'TX' }).success).toBe(true);
    expect(SignupDetailsSchema.safeParse({ ...SIGNUP, state: 'PR' }).success).toBe(true);
    expect(SignupDetailsSchema.safeParse({ ...SIGNUP, state: null }).success).toBe(true);
    expect(SignupDetailsSchema.safeParse(SIGNUP).success).toBe(true);
    expect(SignupDetailsSchema.safeParse({ ...SIGNUP, state: 'ZZ' }).success).toBe(false);
    expect(SignupDetailsSchema.safeParse({ ...SIGNUP, state: 'tx' }).success).toBe(false);
  });

  it('agreement versions are 1 to 32 characters and the AI answer is required', () => {
    expect(
      SignupDetailsSchema.safeParse({
        ...SIGNUP,
        agreements: { ...SIGNUP.agreements, termsVersion: '' },
      }).success,
    ).toBe(false);
    expect(
      SignupDetailsSchema.safeParse({
        ...SIGNUP,
        agreements: { ...SIGNUP.agreements, privacyPolicyVersion: 'v'.repeat(33) },
      }).success,
    ).toBe(false);
    const withoutAnswer = Object.fromEntries(
      Object.entries(SIGNUP).filter(([key]) => key !== 'aiScreening'),
    );
    expect(SignupDetailsSchema.safeParse(withoutAnswer).success).toBe(false);
    expect(SignupDetailsSchema.safeParse({ ...SIGNUP, aiScreening: true }).success).toBe(true);
  });
});

describe('SignInWithAppleBody', () => {
  const body = { idToken: 'header.payload.signature', code: null, nonce: TOKEN };

  it('SignInWithAppleBody limits name parts to 100 characters', () => {
    const name = { givenName: 'g'.repeat(100), familyName: null };
    expect(SignInWithAppleBodySchema.safeParse({ ...body, name }).success).toBe(true);
    expect(
      fieldIssues(
        SignInWithAppleBodySchema.safeParse({
          ...body,
          name: { ...name, familyName: 'f'.repeat(101) },
        }),
      ),
    ).toEqual([{ path: 'name.familyName', code: 'too_big', params: undefined }]);
  });

  it('defaults intent and bounds the token and code', () => {
    expect(SignInWithAppleBodySchema.parse(body).intent).toBe('sign_in');
    expect(SignInWithAppleBodySchema.safeParse({ ...body, intent: 'add_email' }).success).toBe(
      false,
    );
    expect(
      SignInWithAppleBodySchema.safeParse({ ...body, idToken: 't'.repeat(4097) }).success,
    ).toBe(false);
    expect(SignInWithAppleBodySchema.safeParse({ ...body, code: 'c'.repeat(513) }).success).toBe(
      false,
    );
    expect(SignInWithAppleBodySchema.safeParse({ ...body, code: '' }).success).toBe(false);
  });
});

describe('AppleCallbackForm', () => {
  it("AppleCallbackForm keeps Apple's field names", () => {
    const form = {
      state: 'signed.state',
      code: 'auth-code',
      id_token: 'header.payload.signature',
      user: '{"name":{"firstName":"Fixture","lastName":"Person"}}',
      error: 'user_cancelled_authorize',
    };
    expect(AppleCallbackFormSchema.parse(form)).toEqual(form);
    expect(AppleCallbackFormSchema.parse({ state: 'signed.state', idToken: 'x' })).toEqual({
      state: 'signed.state',
    });
    expect(AppleCallbackFormSchema.safeParse({ error: 'cancelled' }).success).toBe(false);
    expect(AppleCallbackFormSchema.safeParse({ state: 's', error: 'e'.repeat(65) }).success).toBe(
      false,
    );
  });
});

describe('SessionInfo', () => {
  it('SessionInfo for the web has a null token', () => {
    const me = {
      id: '0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60',
      handle: 'fixture',
      name: null,
      bio: null,
      link: null,
      avatar: null,
      avatarPending: false,
      email: null,
      emailStatus: 'ok',
      signInMethods: ['apple'],
      role: 'user',
      status: 'active',
      suspension: null,
      onboardingStep: 'done',
      onboardedAt: '2027-01-15T10:05:00.000Z',
      createdAt: '2027-01-15T10:00:00.000Z',
      newAccountUntil: '2027-01-22T10:00:00.000Z',
      handleChangeAvailableAt: null,
      issues: [{ issueId: 'housing', starred: true }],
      locale: 'en',
      age: {
        method: 'store_signal',
        sourceTier: 'confirmed',
        checkedAt: '2027-01-15T10:00:00.000Z',
      },
      consents: {
        terms: { agreedVersion: '2027-01-01', currentVersion: '2027-01-01' },
        contentPolicy: { agreedVersion: '2027-01-01', currentVersion: '2027-01-01' },
        privacyPolicy: { agreedVersion: null, currentVersion: '2027-01-01' },
        aiScreening: 'granted',
        needed: ['privacy_policy'],
      },
      session: {
        platform: 'web',
        authenticatedAt: '2027-01-15T10:00:00.000Z',
        expiresAt: '2027-04-15T10:00:00.000Z',
        sensitiveActionsUntil: '2027-01-15T10:15:00.000Z',
      },
      location: {
        isSet: false,
        precision: null,
        districtCount: 0,
        bbox: null,
        placeName: null,
        officeCount: 0,
        needsConfirmation: false,
      },
    };
    const info = { token: null, expiresAt: '2027-04-15T10:00:00.000Z', created: false, me };
    expect(SessionInfoSchema.parse(info)).toEqual(info);
    const withoutToken = { expiresAt: info.expiresAt, created: false, me };
    expect(SessionInfoSchema.safeParse(withoutToken).success).toBe(false);
  });
});

// Shared rules that are no OpenAPI component of their own, so they carry no component id.
const NOT_COMPONENTS: ReadonlySet<string> = new Set(['EmailAddressSchema', 'SignInIntentSchema']);

describe('component ids', () => {
  it('component ids equal the type names', () => {
    const named = Object.entries(auth).flatMap(([name, value]) =>
      name.endsWith('Schema') && value instanceof z.ZodType && !NOT_COMPONENTS.has(name)
        ? [{ name, schema: value }]
        : [],
    );
    expect(named.length).toBe(14);
    for (const { name, schema } of named) {
      expect(schema.meta()?.id).toBe(name.slice(0, -'Schema'.length));
    }
  });
});

describe('EmailAddress', () => {
  it("EmailAddress is StartEmailSignInBody's email rule", () => {
    expect(EmailAddressSchema).toBe(StartEmailSignInBodySchema.shape.email);
    expect(EmailAddressSchema.parse('  Person@Example.TEST ')).toBe('person@example.test');
    expect(fieldIssues(EmailAddressSchema.safeParse('not-an-email'))).toEqual([
      { path: '', code: 'invalid_format', params: undefined },
    ]);
    const tooLong = `${'a'.repeat(242)}@example.test`;
    expect(tooLong).toHaveLength(255);
    const issues = EmailAddressSchema.safeParse(tooLong).error?.issues ?? [];
    expect(issues.map((issue) => [issue.code, 'origin' in issue ? issue.origin : null])).toEqual([
      ['too_big', 'string'],
    ]);
    expect(EmailAddressSchema.meta()?.id).toBeUndefined();
  });
});

describe('SignInIntent', () => {
  it('SignInIntent holds the two provider intents', () => {
    expect(SignInIntentSchema.options).toEqual(['sign_in', 'reauth']);
    expect(SignInIntentSchema.safeParse('add_email').success).toBe(false);
    const bodies = [
      {
        schema: SignInWithAppleBodySchema,
        body: { idToken: 'header.payload.signature', code: null, nonce: TOKEN },
      },
      { schema: AppleHandoffBodySchema, body: { code: TOKEN, nonce: TOKEN } },
      {
        schema: SignInWithGoogleBodySchema,
        body: { idToken: 'header.payload.signature', nonce: TOKEN },
      },
    ];
    for (const { schema, body } of bodies) {
      expect(schema.parse(body).intent).toBe('sign_in');
      for (const intent of SignInIntentSchema.options) {
        expect(schema.parse({ ...body, intent }).intent).toBe(intent);
      }
      expect(schema.safeParse({ ...body, intent: 'add_email' }).success).toBe(false);
    }
    expect(SignInIntentSchema.meta()?.id).toBeUndefined();
  });
});
