import { brandVariant } from '@citizenrun/shared';
import type { BrandVariantName } from '@citizenrun/shared';
import * as AppleAuthentication from 'expo-apple-authentication';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import type { ReactElement } from 'react';
import { Platform, Pressable, View } from 'react-native';
import {
  GOOGLE_SIGN_IN_BUTTON_HEIGHT,
  GOOGLE_SIGN_IN_BUTTON_WIDTH,
  GoogleOneTapSignIn,
  GoogleSignInButton as LibraryGoogleButton,
} from 'react-native-nitro-google-signin';
import type { OneTapConfigureParams } from 'react-native-nitro-google-signin';
import { G, Path, Rect, Svg, Text as SvgText } from 'react-native-svg';

import { getAppEnv } from '@/lib/env';
import { session } from '@/platform/session';

import { appleAuthorizeUrl, appleReturnUrl, parseAppleReturn } from './apple-redirect';
import type { AuthSessionReturn } from './apple-redirect';
import { APPLE_CUSTOM_BUTTON, APPLE_LOGO } from './provider-art';
import type {
  AppleSignInButtonProps,
  AppleSignInResult,
  Auth,
  GoogleSignInButtonProps,
  GoogleSignInResult,
  ProviderAvailability,
  ProviderButtonAppearance,
} from './types';

const APPLE_STYLE = {
  black: AppleAuthentication.AppleAuthenticationButtonStyle.BLACK,
  white: AppleAuthentication.AppleAuthenticationButtonStyle.WHITE,
  white_outline: AppleAuthentication.AppleAuthenticationButtonStyle.WHITE_OUTLINE,
} as const;

const GOOGLE_COLOR_SCHEME = {
  outline: 'light',
  filled_blue: 'light',
  filled_black: 'dark',
} as const;

const VARIANTS: readonly BrandVariantName[] = ['development', 'staging', 'production'];

let availability: Promise<ProviderAvailability> | null = null;
/** Whether the Google library has been configured; clearProviderState() reads it. */
let googleReady = false;
/** prepare()'s answer for Google; null until it has answered. */
let googleAnswer: boolean | null = null;
/** The nonce hash the Google library was last configured with (it takes the nonce at configuration). */
let googleConfiguredFor: string | null = null;

/** The configuration prepare() gives the library; null while a client id this platform needs is unset. */
function googleOptions(): OneTapConfigureParams | null {
  const env = getAppEnv();
  if (env.googleWebClientId === null) {
    return null;
  }
  if (Platform.OS === 'ios') {
    if (env.googleIosClientId === null) {
      return null;
    }
    return {
      webClientId: env.googleWebClientId,
      iosClientId: env.googleIosClientId,
      scopes: ['email', 'profile'],
      autoSelectOnSignIn: false,
      offlineAccess: false,
    };
  }
  return {
    webClientId: env.googleWebClientId,
    scopes: ['email', 'profile'],
    autoSelectOnSignIn: false,
    offlineAccess: false,
  };
}

async function appleAvailable(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    try {
      return await AppleAuthentication.isAvailableAsync();
    } catch {
      return false;
    }
  }
  if (getAppEnv().appleServicesId === null) {
    return false;
  }
  // A face without Apple's logo artwork is not Apple's button, so it is never offered.
  if (APPLE_LOGO === null) {
    return false;
  }
  try {
    // Apple refuses a return URL that is not https.
    return session.apiOrigin.startsWith('https://');
  } catch {
    return false;
  }
}

function googleAvailable(): boolean {
  const options = googleOptions();
  if (options === null) {
    googleAnswer = false;
    return false;
  }
  try {
    GoogleOneTapSignIn.configure(options);
  } catch {
    googleAnswer = false;
    return false;
  }
  googleConfiguredFor = null;
  googleReady = true;
  googleAnswer = true;
  return true;
}

async function computeAvailability(): Promise<ProviderAvailability> {
  const apple = await appleAvailable();
  const google = googleAvailable();
  return { apple, google };
}

function sizeStyle(appearance: ProviderButtonAppearance): { width: number; height: number } {
  return { width: appearance.width, height: appearance.height };
}

/** The scheme of this build's variant, or null when the build carries no known variant. */
function variantScheme(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  if (typeof extra !== 'object' || extra === null) {
    return null;
  }
  const variant: unknown = Reflect.get(extra, 'variant');
  const known = VARIANTS.find((name) => name === variant);
  return known === undefined ? null : brandVariant(known).scheme;
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
}

async function appleOnIos(nonceHash: string): Promise<AppleSignInResult> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: nonceHash,
    });
    if (credential.identityToken === null || credential.identityToken === '') {
      return { kind: 'failed', code: 'auth.no_token' };
    }
    const givenName = credential.fullName?.givenName ?? null;
    const familyName = credential.fullName?.familyName ?? null;
    return {
      kind: 'token',
      idToken: credential.identityToken,
      code: credential.authorizationCode ?? null,
      name: givenName === null && familyName === null ? null : { givenName, familyName },
    };
  } catch (error) {
    return errorCode(error) === 'ERR_REQUEST_CANCELED'
      ? { kind: 'cancelled' }
      : { kind: 'failed', code: 'auth.provider_error' };
  }
}

function toSessionReturn(result: WebBrowser.WebBrowserAuthSessionResult): AuthSessionReturn {
  if (result.type === 'success') {
    return { type: 'success', url: result.url };
  }
  switch (result.type) {
    case WebBrowser.WebBrowserResultType.CANCEL:
      return { type: 'cancel' };
    case WebBrowser.WebBrowserResultType.DISMISS:
      return { type: 'dismiss' };
    case WebBrowser.WebBrowserResultType.LOCKED:
      return { type: 'locked' };
    case WebBrowser.WebBrowserResultType.OPENED:
      return { type: 'opened' };
  }
}

async function appleOnAndroid(nonceHash: string, state: string): Promise<AppleSignInResult> {
  const servicesId = getAppEnv().appleServicesId;
  if (servicesId === null) {
    return { kind: 'failed', code: 'auth.not_configured' };
  }
  try {
    const scheme = variantScheme();
    if (scheme === null) {
      return { kind: 'failed', code: 'auth.not_configured' };
    }
    const url = appleAuthorizeUrl({ servicesId, apiOrigin: session.apiOrigin, state, nonceHash });
    const result = await WebBrowser.openAuthSessionAsync(url, appleReturnUrl(scheme));
    return parseAppleReturn(toSessionReturn(result), state);
  } catch {
    return { kind: 'failed', code: 'auth.provider_error' };
  }
}

/**
 * Apple's custom button face on Android, drawn to Apple's rules for a custom button: the fill of
 * the style, the outline of the outlined one, Apple's logo artwork as tall as the button at the
 * leading edge, and the title in the system font at the middle. Apple defines no disabled look, so
 * the face is the same while the button takes no press. The press target carries the name; the
 * drawing is hidden from screen readers.
 */
function AppleButtonFace({
  appearance,
  label,
}: {
  appearance: ProviderButtonAppearance;
  label: string;
}): ReactElement {
  const art = APPLE_CUSTOM_BUTTON;
  const look = art.styles[appearance.appleStyle];
  const { width, height } = appearance;
  // An outline is drawn inside the button's own box, so it is never cut at the edge.
  const inset = look.outline === null ? 0 : art.outlineWidth / 2;
  return (
    <View
      style={sizeStyle(appearance)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height}>
        <Rect
          transform={[{ translateX: inset }, { translateY: inset }]}
          width={width - 2 * inset}
          height={height - 2 * inset}
          rx={art.cornerRadius}
          ry={art.cornerRadius}
          fill={look.background}
          stroke={look.outline ?? 'none'}
          strokeWidth={look.outline === null ? 0 : art.outlineWidth}
        />
        {APPLE_LOGO === null ? null : (
          <G
            transform={[
              { translateX: art.logoInset },
              { scale: (height * art.logoHeightOfButtonHeight) / APPLE_LOGO.height },
            ]}
          >
            <Path d={APPLE_LOGO.d} fill={look.foreground} />
          </G>
        )}
        <SvgText
          transform={[{ translateX: width / 2 }, { translateY: height / 2 }]}
          textAnchor="middle"
          alignmentBaseline="central"
          fontSize={height * art.titleSizeOfButtonHeight}
          fontWeight={art.titleWeight}
          fill={look.foreground}
        >
          {label}
        </SvgText>
      </Svg>
    </View>
  );
}

function AppleSignInButton(props: AppleSignInButtonProps): ReactElement {
  const { appearance, disabled, testID, accessibilityLabel, nonceHash, state } = props;
  if (Platform.OS === 'ios') {
    const press = (): void => {
      props.onStart();
      void appleOnIos(nonceHash).then((result) => {
        props.onResult(result);
      });
    };
    return (
      <View
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        pointerEvents={disabled ? 'none' : 'auto'}
      >
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={APPLE_STYLE[appearance.appleStyle]}
          style={sizeStyle(appearance)}
          onPress={press}
        />
      </View>
    );
  }
  const press = (): void => {
    props.onStart();
    void appleOnAndroid(nonceHash, state).then((result) => {
      props.onResult(result);
    });
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={testID}
      style={sizeStyle(appearance)}
      onPress={press}
    >
      <AppleButtonFace appearance={appearance} label={accessibilityLabel} />
    </Pressable>
  );
}

async function googleSignIn(nonceHash: string): Promise<GoogleSignInResult> {
  try {
    if (googleConfiguredFor !== nonceHash) {
      const options = googleOptions();
      if (options === null) {
        return { kind: 'failed', code: 'auth.not_configured' };
      }
      GoogleOneTapSignIn.configure({ ...options, nonce: nonceHash });
      googleConfiguredFor = nonceHash;
      googleReady = true;
    }
    const response = await GoogleOneTapSignIn.presentExplicitSignIn();
    switch (response.type) {
      case 'success': {
        const idToken = response.data?.idToken ?? '';
        return idToken === ''
          ? { kind: 'failed', code: 'auth.no_token' }
          : { kind: 'token', idToken };
      }
      case 'cancelled':
        return { kind: 'cancelled' };
      case 'noSavedCredentialFound':
        return { kind: 'failed', code: 'auth.no_token' };
      default:
        return { kind: 'failed', code: 'auth.provider_error' };
    }
  } catch {
    return { kind: 'failed', code: 'auth.provider_error' };
  }
}

function GoogleSignInButton(props: GoogleSignInButtonProps): ReactElement | null {
  const { appearance, disabled, testID, accessibilityLabel, nonceHash } = props;
  // Guards a stale reference only: the view-model draws the button from prepare()'s answer, and nothing of
  // Google is drawn while its client ids are unset.
  if (googleAnswer === false || googleOptions() === null) {
    return null;
  }
  const press = (): void => {
    props.onStart();
    void googleSignIn(nonceHash).then((result) => {
      props.onResult(result);
    });
  };
  return (
    <LibraryGoogleButton
      signInBehavior="none"
      colorScheme={GOOGLE_COLOR_SCHEME[appearance.googleTheme]}
      size={appearance.width >= GOOGLE_SIGN_IN_BUTTON_WIDTH.wide ? 'wide' : 'standard'}
      style={{ width: appearance.width, height: GOOGLE_SIGN_IN_BUTTON_HEIGHT }}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      onPress={press}
    />
  );
}

export const auth: Auth = {
  prepare: () => {
    availability ??= computeAvailability();
    return availability;
  },
  AppleSignInButton,
  GoogleSignInButton,
  clearProviderState: async () => {
    if (!googleReady) {
      return;
    }
    try {
      await GoogleOneTapSignIn.signOut();
    } catch {
      // Never rejects (PM-auth).
    }
  },
};

export type * from './types';
