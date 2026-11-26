import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { AUTH_NAMESPACES } from '@/features/auth/components/auth-translation';
import { CodeControl } from '@/features/auth/components/code-control';
import { EmailField, isEmailAddress } from '@/features/auth/components/email-field';
import type { SignInViewModel } from '@/features/auth/view-models/sign-in.types';
import { Button } from '@/ui/components/button';
import { Sheet } from '@/ui/components/sheet';
import { Skeleton } from '@/ui/components/skeleton';

export type AddEmailSheetProps = {
  /** The caller's words for what the sheet does. */
  title: string;
  stage: 'closed' | 'email' | 'code';
  email: SignInViewModel['email'];
  code: SignInViewModel['code'];
  onClose: () => void;
};

type OpenStage = Exclude<AddEmailSheetProps['stage'], 'closed'>;
type Code = NonNullable<SignInViewModel['code']>;

/** A whole sign-in code. */
const WHOLE_CODE = /^[0-9]{6}$/;

/**
 * Adds an email to an account that has none: the address, then the code sent to it, as the same
 * two stages of sign-in in a sheet. What is typed lives here: the address goes when the sheet
 * closes, and the digits go with the code they were typed for.
 */
export function AddEmailSheet({
  title,
  stage,
  email,
  code,
  onClose,
}: AddEmailSheetProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const [address, setAddress] = useState('');
  const [digits, setDigits] = useState('');
  // The stage last shown, which a closing sheet keeps drawing while it leaves.
  const [last, setLast] = useState<OpenStage>('email');
  const [wasOpen, setWasOpen] = useState(stage !== 'closed');
  const status: Code['status'] | null = stage === 'code' && code !== null ? code.status : null;
  const [answered, setAnswered] = useState(status);

  if (stage !== 'closed' && last !== stage) {
    setLast(stage);
  }
  if (wasOpen !== (stage !== 'closed')) {
    setWasOpen(stage !== 'closed');
    if (stage === 'closed') {
      setAddress('');
    }
  }
  if (answered !== status) {
    setAnswered(status);
    // A code that turned out wrong is typed again from the first box.
    if (status === 'wrong' || status === null) {
      setDigits('');
    }
  }

  const valid = isEmailAddress(address);
  const sending = email.status === 'sending';
  const submitAddress = (): void => {
    if (valid && !sending) {
      email.onSubmit(address.trim());
    }
  };
  const whole = WHOLE_CODE.test(digits);
  const spent = code !== null && (code.status === 'locked' || code.status === 'expired');

  const drawn: OpenStage = stage === 'closed' ? last : stage;
  const button =
    drawn === 'email' ? (
      <Button
        variant="primary"
        fullWidth={true}
        label={valid ? t('auth:email.continue') : t('auth:email.needAddress')}
        onPress={submitAddress}
        disabled={!valid}
        busy={sending}
        testID="auth.email-continue"
      />
    ) : code !== null ? (
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
    ) : null;

  return (
    <Sheet
      open={stage !== 'closed'}
      onClose={onClose}
      title={title}
      footer={button}
      testID="auth.add-email-sheet"
    >
      {drawn === 'email' ? (
        <EmailField
          value={address}
          onChangeText={setAddress}
          onSubmit={submitAddress}
          errorCode={email.errorCode}
          retryAfterSeconds={email.retryAfterSeconds}
          testID="auth.email-field"
        />
      ) : code !== null ? (
        <CodeControl
          code={code}
          value={digits}
          onChangeText={setDigits}
          testIDs={{ field: 'auth.code-field' }}
        />
      ) : (
        // The code stage without its code: the sheet is working, and asks nothing.
        <Skeleton shape="line" lines={2} />
      )}
    </Sheet>
  );
}
