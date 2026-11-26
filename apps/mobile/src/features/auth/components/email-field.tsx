import { StartEmailSignInBodySchema } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { TextField } from '@/ui/components/text-field';

import { AUTH_NAMESPACES } from './auth-translation';
import { errorSentence } from './notice-text';

export type EmailFieldProps = {
  value: string;
  onChangeText: (value: string) => void;
  /** The keyboard's own key. */
  onSubmit: () => void;
  /** Why the address was refused; null while it was not. */
  errorCode: ErrorCode | null;
  /** The wait a limit asks for. The sentence of a limit names no number, so it is not worded. */
  retryAfterSeconds: number | null;
  testID: string;
};

/** Whether the text is an address the service takes a code request for. */
export function isEmailAddress(value: string): boolean {
  return StartEmailSignInBodySchema.shape.email.safeParse(value.trim()).success;
}

/** The address a sign-in code is sent to. A refusal is said in the field's own line. */
export function EmailField({
  value,
  onChangeText,
  onSubmit,
  errorCode,
  testID,
}: EmailFieldProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  return (
    <TextField
      kind="email"
      label={t('auth:email.label')}
      value={value}
      onChangeText={onChangeText}
      autoFocus={true}
      submitLabel="next"
      onSubmit={onSubmit}
      {...(errorCode === null
        ? {}
        : { status: 'error' as const, statusText: errorSentence(errorCode, t) })}
      testID={testID}
    />
  );
}
