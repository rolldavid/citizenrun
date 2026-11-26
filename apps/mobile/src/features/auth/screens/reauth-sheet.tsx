import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { AUTH_NAMESPACES } from '@/features/auth/components/auth-translation';
import { CodeControl } from '@/features/auth/components/code-control';
import { signInNoticeText } from '@/features/auth/components/notice-text';
import { ProviderOptions } from '@/features/auth/components/provider-options';
import { useProviderAppearance } from '@/features/auth/components/use-provider-appearance';
import type { ReauthViewModel } from '@/features/auth/view-models/reauth.types';
import { Button } from '@/ui/components/button';
import { Notice } from '@/ui/components/notice';
import { Sheet } from '@/ui/components/sheet';
import { Text } from '@/ui/components/text';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

type Code = NonNullable<ReauthViewModel['code']>;

/** A whole sign-in code. */
const WHOLE_CODE = /^[0-9]{6}$/;

const CONTROL: ViewStyle = { marginTop: space.x4 };
const NOTICE: ViewStyle = { marginBottom: space.x4 };
// The column the sign-in options stand in: flush left, at most as wide as a provider button is drawn.
const PROVIDERS: ViewStyle = {
  width: '100%',
  maxWidth: size.authButtonMax,
  alignSelf: 'flex-start',
  gap: space.x3,
};

/**
 * The digits typed so far. A code that turned out wrong is typed again from the first box, and
 * nothing typed outlives the code it was typed for.
 */
function useDigits(status: Code['status'] | null): [string, (value: string) => void] {
  const [value, setValue] = useState('');
  const [answered, setAnswered] = useState(status);
  if (answered !== status) {
    setAnswered(status);
    if (status === 'wrong' || status === null) {
      setValue('');
    }
  }
  return [value, setValue];
}

type ProviderButtonsProps = Pick<ReauthViewModel, 'appleButton' | 'googleButton'>;

/**
 * The providers' own buttons with no email option under them, for an account that has no address a
 * code could go to. Nothing here styles or wraps them.
 */
function ProviderButtons({
  appleButton: AppleButton,
  googleButton: GoogleButton,
}: ProviderButtonsProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const layout = useBreakpoint();
  // The width the column will take, until it is measured.
  const expected = Math.max(0, Math.min(layout.width, size.dialogMax) - 2 * layout.gutter);
  const [measured, setMeasured] = useState<number | null>(null);
  const appearance = useProviderAppearance(measured ?? expected);
  return (
    <View
      style={PROVIDERS}
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
    </View>
  );
}

/**
 * The re-authentication sheet (R-122): a fresh sign-in before an export or a deletion, by the ways
 * the account itself signs in. The email option sends a code to the account's own address, so the
 * sheet never asks for one. Once a code was sent, the six boxes stand in place of the options.
 */
export function ReauthSheet({ vm }: { vm: ReauthViewModel }): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const { code } = vm;
  const [digits, setDigits] = useDigits(vm.open && code !== null ? code.status : null);
  const notice = vm.notice === null ? null : signInNoticeText(vm.notice, t);

  const appleButton = vm.methods.includes('apple') ? vm.appleButton : null;
  const googleButton = vm.methods.includes('google') ? vm.googleButton : null;
  const whole = WHOLE_CODE.test(digits);
  const spent = code !== null && (code.status === 'locked' || code.status === 'expired');

  return (
    <Sheet
      open={vm.open}
      onClose={vm.onClose}
      title={t('auth:reauth.title')}
      footer={
        code === null ? undefined : (
          <Button
            variant="primary"
            fullWidth={true}
            label={whole || spent ? t('auth:code.verify') : t('auth:code.needCode')}
            onPress={() => {
              code.onSubmit(digits);
            }}
            disabled={!whole || spent}
            busy={code.status === 'checking'}
            testID="auth.code-verify"
          />
        )
      }
      testID="auth.reauth-sheet"
    >
      <Text role="body" tone="secondary">
        {t('auth:reauth.body')}
      </Text>
      <View style={CONTROL}>
        {notice === null ? null : (
          <View style={NOTICE}>
            <Notice kind={notice.kind} text={notice.text} />
          </View>
        )}
        {code !== null ? (
          <CodeControl
            code={code}
            value={digits}
            onChangeText={setDigits}
            testIDs={{ field: 'auth.code-field' }}
          />
        ) : vm.methods.includes('email') ? (
          <ProviderOptions
            appleButton={appleButton}
            googleButton={googleButton}
            email={{
              label: t('auth:reauth.sendCode'),
              onPress: vm.onSendCode,
              busy: vm.emailStatus === 'sending',
              testID: 'auth.reauth-email',
            }}
            busy={vm.providersBusy}
          />
        ) : (
          <ProviderButtons appleButton={appleButton} googleButton={googleButton} />
        )}
      </View>
    </Sheet>
  );
}
