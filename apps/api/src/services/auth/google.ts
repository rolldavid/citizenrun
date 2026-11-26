import { jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { ApiError } from '@citizenrun/shared';
import type { ApiEnv } from '../../env.ts';
import { PROVIDER_CLOCK_TOLERANCE_S, PROVIDER_TOKEN_ALGORITHMS } from './apple.ts';
import type { IdentityInput } from './resolve-identity.ts';

/** The claims of a verified Google identity token that sign-in reads. */
export type GoogleIdClaims = {
  sub: string;
  aud: string;
  nonce: string | null;
  email: string | null;
  emailVerified: boolean;
  hd: string | null;
};

// Google writes its issuer in two forms (L-google).
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// The one address host whose verified addresses Google is authoritative for (D-245).
const GMAIL_SUFFIX = '@gmail.com';

/** GOOGLE_CLIENT_IDS split on commas and trimmed; empty while unset or empty (03a 1.25). */
export function googleAudiences(env: ApiEnv): readonly string[] {
  const raw = env.GOOGLE_CLIENT_IDS;
  if (raw === null) {
    return [];
  }
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

const GoogleClaimsSchema = z.object({
  sub: z.string().min(1),
  aud: z.string(),
  nonce: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.unknown().optional(),
  hd: z.string().optional(),
});

/** Throws ApiError('identity_token_invalid') on any failure. */
export async function verifyGoogleIdToken(
  keys: JWTVerifyGetKey,
  idToken: string,
  audiences: readonly string[],
  now: Date,
): Promise<GoogleIdClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: [...audiences],
      algorithms: PROVIDER_TOKEN_ALGORITHMS,
      clockTolerance: PROVIDER_CLOCK_TOLERANCE_S,
      currentDate: now,
    }));
  } catch {
    throw new ApiError('identity_token_invalid');
  }
  const parsed = GoogleClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError('identity_token_invalid');
  }
  const claims = parsed.data;
  return {
    sub: claims.sub,
    aud: claims.aud,
    nonce: claims.nonce ?? null,
    email: claims.email === undefined ? null : claims.email.toLowerCase(),
    emailVerified: claims.email_verified === true,
    hd: claims.hd ?? null,
  };
}

/** Input V of L-account-link for a Google token: the subject is `sub`, never the email (D-245). */
export function googleIdentityInput(claims: GoogleIdClaims): IdentityInput {
  const { email } = claims;
  return {
    provider: 'google',
    subject: claims.sub,
    email,
    emailVerified: claims.emailVerified,
    emailVerifiedAuthoritative:
      email !== null &&
      claims.emailVerified &&
      (email.endsWith(GMAIL_SUFFIX) || claims.hd !== null),
    isPrivateEmail: null,
  };
}
