import { typeRoles } from '@citizenrun/shared';
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as NativeText, TextInput, View } from 'react-native';
import type { TextInputInstance, TextStyle, ViewStyle } from 'react-native';

import type { IconName } from '@/ui/icons';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

import { FieldFrame, useFieldTextStyle } from './field-frame';
import { FieldShell, describedByProps, useFieldA11y } from './field-shell';
import { Icon } from './icon';
import { IconButton } from './icon-button';
import { useInteractionPreview } from './pressable';
import { Text } from './text';

export type TextFieldProps = {
  label: string;
  labelHidden?: boolean;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  helper?: string;
  status?: 'none' | 'error' | 'valid';
  statusText?: string;
  /** Sets the keyboard, the capitalization and what the system may fill in. Default 'text'. */
  kind?: 'text' | 'email' | 'url' | 'number' | 'multiline';
  maxLength?: number;
  /** With `maxLength`: the count at the right of the helper line. */
  showCount?: boolean;
  leadingIcon?: IconName;
  /** Shows a clear button at the right while the value is not empty. */
  onClear?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  submitLabel?: 'done' | 'next' | 'search' | 'send';
  onSubmit?: () => void;
  testID: string;
};

type Kind = NonNullable<TextFieldProps['kind']>;

type InputProps = Pick<
  TextFieldProps,
  | 'value'
  | 'onChangeText'
  | 'placeholder'
  | 'maxLength'
  | 'leadingIcon'
  | 'onClear'
  | 'submitLabel'
  | 'onSubmit'
  | 'testID'
> & {
  kind: Kind;
  status: NonNullable<TextFieldProps['status']>;
  disabled: boolean;
  autoFocus: boolean;
};

/** What each kind sets on the input. */
const KIND_PROPS = {
  text: { inputMode: 'text', autoCapitalize: 'sentences' },
  email: {
    inputMode: 'email',
    autoComplete: 'email',
    autoCapitalize: 'none',
    autoCorrect: false,
    textContentType: 'emailAddress',
  },
  url: { inputMode: 'url', autoComplete: 'url', autoCapitalize: 'none', autoCorrect: false },
  number: { inputMode: 'numeric', autoCapitalize: 'none' },
  multiline: { multiline: true, autoCapitalize: 'sentences', textAlignVertical: 'top' },
} as const;

/** The fewest and the most lines a multiline field shows before its text scrolls inside it. */
const LINES = { fewest: 3, most: 8 } as const;

/** Ends the copy of the text, so a last line that is still empty has its height. */
const ZERO_WIDTH_SPACE = '\u200B';

// One line is as tall as its row, so the text stands in the middle of the frame.
const ONE_LINE: TextStyle = { alignSelf: 'stretch' };
// The first line of several stands where the one line of a single-line field does.
const LINES_ROW: ViewStyle = {
  flex: 1,
  flexDirection: 'row',
  alignItems: 'stretch',
  overflow: 'hidden',
  marginVertical: space.x2,
};
// The copy is as wide as the row and takes none of its width, so the input lies over it.
const COPY: TextStyle = { width: '100%', marginRight: '-100%', flexShrink: 0, opacity: 0 };
// Clear of the frame's edge by the room the icon keeps inside its own target.
const CLEAR: ViewStyle = { marginRight: -space.x2 };

/** The input in its frame; it reads its name and its description from the field around it. */
function Input({
  value,
  onChangeText,
  placeholder,
  kind,
  status,
  maxLength,
  leadingIcon,
  onClear,
  disabled,
  autoFocus,
  submitLabel,
  onSubmit,
  testID,
}: InputProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const { t } = useTranslation('common');
  const { describedBy, ...named } = useFieldA11y();
  const preview = useInteractionPreview();
  const input = useRef<TextInputInstance>(null);
  const [isFocused, setFocused] = useState(false);
  const text = useFieldTextStyle(disabled);

  const focused = !disabled && (isFocused || preview.focused === true);
  const multiline = kind === 'multiline';
  // One line of the text at the text size in use.
  const line = typeRoles.body.lineHeight * theme.textScale * layout.fontScale;
  const focus = (): void => {
    input.current?.focus();
  };

  const field = (
    <TextInput
      ref={input}
      {...KIND_PROPS[kind]}
      {...named}
      {...describedByProps(describedBy)}
      aria-disabled={disabled ? true : undefined}
      style={[text, multiline ? { maxHeight: LINES.most * line } : ONE_LINE]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.color.textSecondary}
      maxLength={maxLength}
      editable={!disabled}
      autoFocus={autoFocus}
      returnKeyType={submitLabel}
      enterKeyHint={submitLabel}
      onSubmitEditing={onSubmit}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      testID={testID}
    />
  );

  return (
    <FieldFrame
      status={status}
      focused={focused}
      disabled={disabled}
      onPress={focus}
      {...(leadingIcon === undefined
        ? {}
        : {
            leading: (
              <Icon name={leadingIcon} size="medium" tone={disabled ? 'disabled' : 'secondary'} />
            ),
          })}
      {...(onClear === undefined || value === '' || disabled
        ? {}
        : {
            trailing: (
              <View style={CLEAR}>
                <IconButton
                  icon="close"
                  size="sm"
                  label={t('ui.clear')}
                  testID={`${testID}-clear`}
                  onPress={() => {
                    onClear();
                    focus();
                  }}
                />
              </View>
            ),
          })}
    >
      {multiline ? (
        // The field is as tall as its text, between the fewest and the most lines: the row takes
        // the taller of the input and an unseen copy of the text laid out in the same style, and
        // the input fills the row and scrolls what the row cannot hold.
        <View style={[LINES_ROW, { minHeight: LINES.fewest * line, maxHeight: LINES.most * line }]}>
          <NativeText
            style={[text, COPY]}
            selectable={false}
            pointerEvents="none"
            aria-hidden={true}
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
          >
            {value}
            {ZERO_WIDTH_SPACE}
          </NativeText>
          {field}
        </View>
      ) : (
        field
      )}
    </FieldFrame>
  );
}

/**
 * C-TextField: one line or several lines of typed text, under its label and over its helper or
 * status line. The focus ring shows for a pointer and a keyboard alike. What is typed is held by
 * the caller alone.
 */
export function TextField({
  label,
  labelHidden = false,
  value,
  onChangeText,
  placeholder,
  helper,
  status = 'none',
  statusText,
  kind = 'text',
  maxLength,
  showCount = false,
  leadingIcon,
  onClear,
  disabled = false,
  autoFocus = false,
  submitLabel,
  onSubmit,
  testID,
}: TextFieldProps): JSX.Element {
  const { t } = useTranslation('common');
  const counts = showCount && maxLength !== undefined;
  const atLimit = counts && value.length === maxLength;

  return (
    <FieldShell
      label={label}
      labelHidden={labelHidden}
      status={status}
      announce="alert"
      {...(helper === undefined ? {} : { helper })}
      {...(statusText === undefined ? {} : { statusText })}
      {...(counts
        ? {
            trailingLine: (
              // At the limit the count is a new element that is said once, at the next pause.
              <View
                key={atLimit ? 'limit' : 'count'}
                accessibilityLiveRegion={atLimit ? 'polite' : undefined}
                aria-live={atLimit ? 'polite' : undefined}
              >
                <Text role="mono" tone="secondary" tabular={true}>
                  {t('ui.field.count', { count: value.length, max: maxLength })}
                </Text>
              </View>
            ),
          }
        : {})}
    >
      <Input
        value={value}
        onChangeText={onChangeText}
        kind={kind}
        status={status}
        disabled={disabled}
        autoFocus={autoFocus}
        testID={testID}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(maxLength === undefined ? {} : { maxLength })}
        {...(leadingIcon === undefined ? {} : { leadingIcon })}
        {...(onClear === undefined ? {} : { onClear })}
        {...(submitLabel === undefined ? {} : { submitLabel })}
        {...(onSubmit === undefined ? {} : { onSubmit })}
      />
    </FieldShell>
  );
}
