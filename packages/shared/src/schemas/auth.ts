import { z } from 'zod';
import { STATE_CODES } from '../constants/geo.ts';
import { InstantSchema } from './common.ts';
import { MeSchema } from './me.ts';

// A pending token, nonce or hand-off code: 32 random bytes in unpadded base64url (L-keys).
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The answer of every successful sign-in; `token` is null on the web, where the cookie carries the session. */
export const SessionInfoSchema = z
  .object({
    token: z.string().nullable(),
    expiresAt: InstantSchema,
    created: z.boolean(),
    me: MeSchema,
  })
  .meta({ id: 'SessionInfo' });

export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** The answer of an email sign-in start: the challenge's token, its expiry and the earliest resend (E-AUTH-01). */
export const EmailStartResultSchema = z
  .object({
    pendingToken: z.string(),
    expiresAt: InstantSchema,
    resendAvailableAt: InstantSchema,
  })
  .meta({ id: 'EmailStartResult' });

export type EmailStartResult = z.infer<typeof EmailStartResultSchema>;

/** A single-use sign-in nonce, its hash for the provider and the signed Apple state (E-AUTH-03, D-241). */
export const NonceResultSchema = z
  .object({
    nonce: z.string(),
    nonceHash: z.string(),
    state: z.string(),
    expiresAt: InstantSchema,
  })
  .meta({ id: 'NonceResult' });

export type NonceResult = z.infer<typeof NonceResultSchema>;

/**
 * The sign-up answers sent with a sign-in that may create a user: how the age was checked (the store's
 * adult signal with its tier, or `none` when no signal came: sign-up asks no age, D-897), the agreement
 * versions and, when asked, the state lived in, which is never stored (L-account-link).
 */
export const SignupDetailsSchema = z
  .object({
    age: z.object({
      method: z.enum(['store_signal', 'none']),
      sourceTier: z.enum(['confirmed', 'declared']).nullable(),
    }),
    agreements: z.object({
      termsVersion: z.string().min(1).max(32),
      contentPolicyVersion: z.string().min(1).max(32),
      privacyPolicyVersion: z.string().min(1).max(32),
    }),
    state: z.enum(STATE_CODES).nullable().optional(),
  })
  .superRefine((details, ctx) => {
    const { method, sourceTier } = details.age;
    // A store signal carries its tier; no signal carries none.
    const isPaired = method === 'store_signal' ? sourceTier !== null : sourceTier === null;
    if (!isPaired) {
      ctx.addIssue({
        code: 'custom',
        path: ['age', 'sourceTier'],
        params: { code: 'invalid_value' },
        message: 'The source tier does not match the age method.',
      });
    }
  })
  .meta({ id: 'SignupDetails' });

export type SignupDetails = z.infer<typeof SignupDetailsSchema>;

/** The body of `POST /v1/auth/email/start` (E-AUTH-01); the email is trimmed and lower-cased before it is checked. */
export const StartEmailSignInBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().min(3).max(254).check(z.email()),
    pendingToken: z.string().regex(TOKEN_PATTERN).optional(),
  })
  .meta({ id: 'StartEmailSignInBody' });

export type StartEmailSignInBody = z.infer<typeof StartEmailSignInBodySchema>;

/** The body of `POST /v1/auth/email/verify` (E-AUTH-02); `intent` defaults to `sign_in`. */
export const VerifyEmailSignInBodySchema = z
  .object({
    pendingToken: z.string().regex(TOKEN_PATTERN),
    code: z.string().regex(/^[0-9]{6}$/),
    intent: z.enum(['sign_in', 'reauth', 'add_email']).default('sign_in'),
    signup: SignupDetailsSchema.optional(),
  })
  .meta({ id: 'VerifyEmailSignInBody' });

export type VerifyEmailSignInBody = z.infer<typeof VerifyEmailSignInBodySchema>;

/** The body of `POST /v1/auth/nonce` (E-AUTH-03): empty. */
export const CreateAuthNonceBodySchema = z.object({}).meta({ id: 'CreateAuthNonceBody' });

export type CreateAuthNonceBody = z.infer<typeof CreateAuthNonceBodySchema>;

/** The body of `POST /v1/auth/apple` (E-AUTH-04); `name` comes only with Apple's first authorization. */
export const SignInWithAppleBodySchema = z
  .object({
    idToken: z.string().min(1).max(4096),
    code: z.string().min(1).max(512).nullable(),
    nonce: z.string().regex(TOKEN_PATTERN),
    name: z
      .object({
        givenName: z.string().max(100).nullable(),
        familyName: z.string().max(100).nullable(),
      })
      .optional(),
    intent: z.enum(['sign_in', 'reauth']).default('sign_in'),
    signup: SignupDetailsSchema.optional(),
  })
  .meta({ id: 'SignInWithAppleBody' });

export type SignInWithAppleBody = z.infer<typeof SignInWithAppleBodySchema>;

/** Apple's form post to `POST /v1/auth/apple/callback` (E-AUTH-05), with Apple's own field names. */
export const AppleCallbackFormSchema = z
  .object({
    state: z.string().min(1).max(1024),
    code: z.string().max(512).optional(),
    id_token: z.string().max(4096).optional(),
    user: z.string().max(1024).optional(),
    error: z.string().max(64).optional(),
  })
  .meta({ id: 'AppleCallbackForm' });

export type AppleCallbackForm = z.infer<typeof AppleCallbackFormSchema>;

/** The body of `POST /v1/auth/apple/handoff` (E-AUTH-06): the redirect's code and the raw nonce. */
export const AppleHandoffBodySchema = z
  .object({
    code: z.string().regex(TOKEN_PATTERN),
    nonce: z.string().regex(TOKEN_PATTERN),
    intent: z.enum(['sign_in', 'reauth']).default('sign_in'),
    signup: SignupDetailsSchema.optional(),
  })
  .meta({ id: 'AppleHandoffBody' });

export type AppleHandoffBody = z.infer<typeof AppleHandoffBodySchema>;

/** The body of Apple's server notice to `POST /v1/auth/apple/notifications` (E-AUTH-07): a signed JWT. */
export const AppleNotificationBodySchema = z
  .object({ payload: z.string().min(1).max(8192) })
  .meta({ id: 'AppleNotificationBody' });

export type AppleNotificationBody = z.infer<typeof AppleNotificationBodySchema>;

/** The answer to Apple's server notice (E-AUTH-07): empty. */
export const ReceiveAppleNotificationResponseSchema = z
  .object({})
  .meta({ id: 'ReceiveAppleNotificationResponse' });

export type ReceiveAppleNotificationResponse = z.infer<
  typeof ReceiveAppleNotificationResponseSchema
>;

/** The body of `POST /v1/auth/google` (E-AUTH-08). */
export const SignInWithGoogleBodySchema = z
  .object({
    idToken: z.string().min(1).max(4096),
    nonce: z.string().regex(TOKEN_PATTERN),
    intent: z.enum(['sign_in', 'reauth']).default('sign_in'),
    signup: SignupDetailsSchema.optional(),
  })
  .meta({ id: 'SignInWithGoogleBody' });

export type SignInWithGoogleBody = z.infer<typeof SignInWithGoogleBodySchema>;

/** The body of `POST /v1/auth/logout` (E-AUTH-09): empty. */
export const LogoutBodySchema = z.object({}).meta({ id: 'LogoutBody' });

export type LogoutBody = z.infer<typeof LogoutBodySchema>;

/** The one email rule of the sign-in routes: StartEmailSignInBody's `email` field itself (E-AUTH-01, E-AUTH-11). */
export const EmailAddressSchema = StartEmailSignInBodySchema.shape.email;

/** The intents of the provider sign-ins; E-AUTH-02 also allows 'add_email'. */
export const SignInIntentSchema = z.enum(['sign_in', 'reauth']);

export type SignInIntent = z.infer<typeof SignInIntentSchema>;
