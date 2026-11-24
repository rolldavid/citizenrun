import type { ComponentType } from 'react';

export type AuthFailureCode =
  | 'auth.not_configured' // this build has no client id or Services ID for the provider
  | 'auth.unavailable' // the provider cannot start here (script failed to load, Apple not available on the device, library missing)
  | 'auth.state_mismatch' // Android Apple: the redirect's state differs from the one sent (D-169)
  | 'auth.no_token' // the provider answered without an identity token
  | 'auth.provider_error'; // any other provider error

/** E-AUTH-05's redirect `error` reasons other than `cancelled`. The caller shows `errors:identity_token_invalid`
 *  for `state_invalid` and `token_invalid`, and `errors:<reason>` for every other reason (D-530), including
 *  `provider_not_configured`, the API's answer while its Apple settings are unset (D-416). */
export type AppleCallbackError =
  | 'state_invalid'
  | 'token_invalid'
  | 'nonce_invalid'
  | 'account_deleting'
  | 'account_banned'
  | 'signups_closed'
  | 'signup_limit_reached'
  | 'rate_limited'
  | 'invalid_request'
  | 'unavailable'
  | 'provider_not_configured';

export type AppleSignInResult =
  /** iOS and web: post to E-AUTH-04 with the raw nonce. `name` only on the first authorization (D-169). */
  | {
      kind: 'token';
      idToken: string;
      code: string | null;
      name: { givenName: string | null; familyName: string | null } | null;
    }
  /** Android: the hand-off code of E-AUTH-05's redirect, already checked against `state`; post to E-AUTH-06. */
  | { kind: 'handoff'; code: string }
  /** Android: the API's callback refused (E-AUTH-05). */
  | { kind: 'server_refused'; reason: AppleCallbackError }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: AuthFailureCode };

export type GoogleSignInResult =
  /** Post to E-AUTH-08 with the raw nonce. */
  | { kind: 'token'; idToken: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: AuthFailureCode };

/** The provider variant a screen chose within each provider's rules. */
export type ProviderButtonAppearance = {
  appleStyle: 'black' | 'white' | 'white_outline';
  googleTheme: 'outline' | 'filled_black' | 'filled_blue';
  googleShape: 'rectangular' | 'pill';
  googleSize: 'large' | 'medium';
  width: number; // points
  height: number; // points; providers that fix their own height ignore it
};

export type ProviderButtonBase = {
  /** E-AUTH-03's nonceHash: what the provider puts in the token's nonce claim (D-241, CTL-13). */
  nonceHash: string;
  appearance: ProviderButtonAppearance;
  disabled: boolean;
  /** Called when the provider's flow opens, so the screen can show its busy state. */
  onStart(): void;
  testID: string;
  accessibilityLabel: string;
};

export type AppleSignInButtonProps = ProviderButtonBase & {
  /** E-AUTH-03's state; used only by Android's browser flow and checked against the redirect (D-169). */
  state: string;
  onResult(result: AppleSignInResult): void;
};

export type GoogleSignInButtonProps = ProviderButtonBase & {
  onResult(result: GoogleSignInResult): void;
};

export type ProviderAvailability = { apple: boolean; google: boolean };

export interface Auth {
  /** Loads what the buttons need (the web's two provider scripts; the phone Google library's configuration) and
   *  answers which providers this build and device can offer. Idempotent; later calls answer the first result. */
  prepare(): Promise<ProviderAvailability>;
  AppleSignInButton: ComponentType<AppleSignInButtonProps>;
  GoogleSignInButton: ComponentType<GoogleSignInButtonProps>;
  /** Forgets the provider's remembered account, so the next sign-in asks again. Never rejects. Called by session.endLocal(). */
  clearProviderState(): Promise<void>;
}
