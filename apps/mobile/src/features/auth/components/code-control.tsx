import { assertNever } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { SignInViewModel } from '@/features/auth/view-models/sign-in.types';
import { Button } from '@/ui/components/button';
import { CodeField } from '@/ui/components/code-field';
import type { CodeFieldProps } from '@/ui/components/code-field';
import { Text } from '@/ui/components/text';
import { rule, space } from '@/ui/tokens';

import { AUTH_NAMESPACES } from './auth-translation';
import type { AuthT } from './auth-translation';
import { useSecondsUntil } from './use-seconds-until';

type Code = NonNullable<SignInViewModel['code']>;

export type CodeControlProps = {
  code: Code;
  /** The digits typed so far; the caller empties them when a code turns out wrong. */
  value: string;
  onChangeText: (value: string) => void;
  testIDs: { field: string };
};

const SENT_TO: ViewStyle = { marginTop: space.x2 };
// A quiet button keeps its words inside its own padding and border; the row moves out by that
// much, so the words stand on the edge the field and the line above them stand on.
const QUIET_INSET = space.x2 + rule.hairline;
const ACTIONS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: space.x2,
  marginTop: space.x3,
  marginHorizontal: -QUIET_INSET,
};

const SECONDS_PER_MINUTE = 60;

/** How the field looks for each answer to a code; an expired code locks the field as a spent one does. */
function fieldStatus(status: Code['status']): CodeFieldProps['status'] {
  switch (status) {
    case 'idle':
    case 'checking':
    case 'wrong':
      return status;
    case 'locked':
    case 'expired':
      return 'locked';
    default:
      return assertNever(status);
  }
}

function statusText(status: Code['status'], t: AuthT): string | null {
  switch (status) {
    case 'idle':
    case 'checking':
      return null;
    case 'wrong':
      return t('auth:code.wrong');
    case 'locked':
      return t('auth:code.locked');
    case 'expired':
      return t('auth:code.expired');
    default:
      return assertNever(status);
  }
}

/** "Send again": it waits out the gap between two codes, and says how long the wait is. */
function ResendButton({ code }: { code: Code }): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const seconds = useSecondsUntil(code.resendAvailableAt);
  const testID = 'auth.code-resend-live';

  if (code.resendStatus === 'limited' && code.resendRetryAfterSeconds !== null) {
    const minutes = Math.ceil(code.resendRetryAfterSeconds / SECONDS_PER_MINUTE);
    return (
      <Button
        variant="quiet"
        label={t('auth:code.resendLimited', { minutes })}
        disabled={true}
        testID={testID}
      />
    );
  }
  if (code.resendStatus === 'limited') {
    // A limit that names no wait.
    return (
      <Button variant="quiet" label={t('errors:rate_limited')} disabled={true} testID={testID} />
    );
  }
  if (seconds > 0) {
    return (
      <Button
        variant="quiet"
        label={t('auth:code.resendIn', { count: seconds })}
        disabled={true}
        testID={testID}
      />
    );
  }
  return (
    <Button
      variant="quiet"
      label={t('auth:code.resend')}
      onPress={code.onResend}
      busy={code.resendStatus === 'sending'}
      testID={testID}
    />
  );
}

/**
 * The sign-in code and what goes with it: the six boxes, the address the code went to, and the two
 * ways on when no code arrives. The field sends the code itself when its sixth digit lands.
 */
export function CodeControl({ code, value, onChangeText, testIDs }: CodeControlProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  return (
    <View>
      <CodeField
        label={t('auth:code.label')}
        value={value}
        onChangeText={onChangeText}
        onComplete={code.onSubmit}
        status={fieldStatus(code.status)}
        statusText={statusText(code.status, t)}
        testID={testIDs.field}
      />
      <View style={SENT_TO}>
        <Text role="caption">{t('auth:code.sentTo', { email: code.sentTo })}</Text>
      </View>
      <View style={ACTIONS}>
        <ResendButton code={code} />
        <Button
          variant="quiet"
          label={t('auth:code.changeEmail')}
          onPress={code.onChangeEmail}
          testID="auth.code-change-email"
        />
      </View>
    </View>
  );
}
