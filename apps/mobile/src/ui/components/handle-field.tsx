import { HANDLE_MAX, assertNever } from '@citizenrun/shared';
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput } from 'react-native';
import type { TextInputInstance, TextStyle } from 'react-native';

import { FieldFrame, useFieldTextStyle } from './field-frame';
import { FieldShell, describedByProps, useFieldA11y } from './field-shell';
import type { FieldShellProps } from './field-shell';
import { sanitizeHandleInput } from './handle-field-input';
import { useInteractionPreview } from './pressable';
import { Text } from './text';

export type HandleFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** What the check of the handle says now. */
  check: 'idle' | 'checking' | 'free' | 'taken' | 'reserved' | 'invalid';
  /** The caller's sentence for the check's answer; none while idle or checking. */
  statusText: string | null;
  testID: string;
};

type Check = HandleFieldProps['check'];

// One line is as tall as its row, so the text stands in the middle of the frame.
const ONE_LINE: TextStyle = { alignSelf: 'stretch' };

/** The state of the field's line for each answer of the check. */
function statusOf(check: Check): FieldShellProps['status'] {
  switch (check) {
    case 'idle':
    case 'checking':
      return 'none';
    case 'free':
      return 'valid';
    case 'taken':
    case 'reserved':
    case 'invalid':
      return 'error';
    default:
      return assertNever(check);
  }
}

type InputProps = Pick<HandleFieldProps, 'value' | 'onChangeText' | 'testID'> & {
  status: FieldShellProps['status'];
};

/** The input behind its "@"; it reads its name and its description from the field around it. */
function Input({ value, onChangeText, status, testID }: InputProps): JSX.Element {
  const { describedBy, ...named } = useFieldA11y();
  const preview = useInteractionPreview();
  const input = useRef<TextInputInstance>(null);
  const [isFocused, setFocused] = useState(false);
  const text = useFieldTextStyle(false);

  return (
    <FieldFrame
      status={status}
      focused={isFocused || preview.focused === true}
      onPress={() => {
        input.current?.focus();
      }}
      leading={
        // The label says what the field is: the sign is drawn, not read out.
        <Text role="body" tone="secondary" hidden={true}>
          @
        </Text>
      }
    >
      <TextInput
        ref={input}
        {...named}
        {...describedByProps(describedBy)}
        style={[text, ONE_LINE]}
        value={value}
        onChangeText={(typed) => {
          onChangeText(sanitizeHandleInput(typed));
        }}
        inputMode="text"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        maxLength={HANDLE_MAX}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        testID={testID}
      />
    </FieldFrame>
  );
}

/**
 * C-HandleField: claims a handle. What is typed is lower-cased and kept to the characters a handle
 * may hold. The line under the field says what the check found: it pulses while the check runs,
 * turns valid for a free handle and turns into an error for one that cannot be taken. The line is
 * always there, so nothing under the field moves as answers arrive.
 */
export function HandleField({
  label,
  value,
  onChangeText,
  check,
  statusText,
  testID,
}: HandleFieldProps): JSX.Element {
  const { t } = useTranslation('common');
  const status = statusOf(check);
  const checking = check === 'checking';

  return (
    <FieldShell
      label={label}
      status={status}
      announce="polite"
      reserveLine={true}
      pulse={checking}
      {...(checking ? { helper: t('ui.handle.checking') } : {})}
      {...(statusText === null ? {} : { statusText })}
    >
      <Input value={value} onChangeText={onChangeText} status={status} testID={testID} />
    </FieldShell>
  );
}
