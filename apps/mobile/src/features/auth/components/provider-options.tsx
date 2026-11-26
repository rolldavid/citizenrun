import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { SignInViewModel } from '@/features/auth/view-models/sign-in.types';
import { Button } from '@/ui/components/button';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

import { AUTH_NAMESPACES } from './auth-translation';
import { useProviderAppearance } from './use-provider-appearance';

export type ProviderOptionsProps = {
  /** Null where Apple sign-in is not offered. */
  appleButton: SignInViewModel['appleButton'];
  /** Null where Google sign-in is not offered. */
  googleButton: SignInViewModel['googleButton'];
  /** The email option, which is always offered. */
  email: { label: string; onPress: () => void; testID: string; busy?: boolean };
  /** A sign-in is under way: the email option takes no press. */
  busy: boolean;
};

// Flush left, as wide as the content up to the widest a provider button is drawn, one option above
// the next.
const COLUMN: ViewStyle = {
  width: '100%',
  maxWidth: size.authButtonMax,
  alignSelf: 'flex-start',
  gap: space.x3,
};

/**
 * The ways to sign in, one above the other: Apple's button, Google's button, then email. The two
 * providers draw their own buttons at their own look, and nothing here styles or wraps them.
 */
export function ProviderOptions({
  appleButton: AppleButton,
  googleButton: GoogleButton,
  email,
  busy,
}: ProviderOptionsProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const layout = useBreakpoint();
  // The width the column will take, until it is measured.
  const expected = Math.max(0, Math.min(layout.width, size.feedColumn) - 2 * layout.gutter);
  const [measured, setMeasured] = useState<number | null>(null);
  const appearance = useProviderAppearance(measured ?? expected);

  return (
    <View
      style={COLUMN}
      onLayout={(event) => {
        setMeasured(event.nativeEvent.layout.width);
      }}
    >
      {AppleButton === null ? null : (
        <AppleButton
          appearance={appearance}
          testID="auth.apple-button"
          accessibilityLabel={t('auth:methods.apple')}
        />
      )}
      {GoogleButton === null ? null : (
        <GoogleButton
          appearance={appearance}
          testID="auth.google-button"
          accessibilityLabel={t('auth:methods.google')}
        />
      )}
      <Button
        variant="secondary"
        fullWidth={true}
        label={email.label}
        onPress={email.onPress}
        disabled={busy}
        busy={email.busy === true}
        testID={email.testID}
      />
    </View>
  );
}
