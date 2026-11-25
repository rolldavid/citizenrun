import { EMAIL_CODE_DIGITS } from '@citizenrun/shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { focusRingStyle } from '@/ui/focus';
import { playHaptic } from '@/ui/haptic';
import { usePulse } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { useFieldTextStyle } from './field-frame';
import { FieldShell, describedByProps, useFieldA11y } from './field-shell';
import { useInteractionPreview } from './pressable';
import { Text } from './text';

export type CodeFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** Called once with the whole code when its last digit arrives. */
  onComplete: (code: string) => void;
  status: 'idle' | 'checking' | 'wrong' | 'locked';
  /** The caller's sentence for a wrong or a locked code; none while idle or checking. */
  statusText: string | null;
  testID: string;
};

type Status = CodeFieldProps['status'];

/** The place of each box in the row. */
const PLACES: readonly number[] = Array.from({ length: EMAIL_CODE_DIGITS }, (_, place) => place);
// As wide as its boxes, and never wider than the room it is given.
const HOLDER: ViewStyle = { alignSelf: 'flex-start', maxWidth: '100%' };
const BOXES: ViewStyle = { flexDirection: 'row', gap: space.x2 };
const BOX: ViewStyle = {
  width: size.codeBox.width,
  height: size.codeBox.height,
  flexShrink: 1,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: radius.control,
};
// The one input lies over the whole row, unseen, and takes every tap, key and paste.
const OVER: TextStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
};
// Read out as the input's description, never drawn.
const UNSEEN: ViewStyle = { display: 'none' };

/** The digits of what was typed or pasted, as many as a code has. */
function digitsOf(text: string): string {
  return text.replace(/\D/g, '').slice(0, EMAIL_CODE_DIGITS);
}

type BoxesProps = Pick<CodeFieldProps, 'value' | 'onChangeText' | 'onComplete' | 'testID'> & {
  status: Status;
};

/** The row of boxes under the one input; the input reads its name from the field around it. */
function Boxes({ value, onChangeText, onComplete, status, testID }: BoxesProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const { describedBy, ...named } = useFieldA11y();
  const preview = useInteractionPreview();
  const hintId = useId();
  const [isFocused, setFocused] = useState(false);
  const pulsing = usePulse(status === 'checking', 'held');
  const text = useFieldTextStyle(false);

  const locked = status === 'locked';
  const wrong = status === 'wrong';
  const takesInput = status === 'idle' || wrong;
  const focused = takesInput && (isFocused || preview.focused === true);
  // The box the next digit goes to; the last one once the code is whole.
  const next = Math.min(value.length, EMAIL_CODE_DIGITS - 1);
  const hint = t('ui.code.hint');

  const box: ViewStyle = locked
    ? { backgroundColor: theme.color.disabledBg }
    : {
        backgroundColor: theme.color.surface,
        borderWidth: wrong ? rule.fieldState : rule.hairline,
        borderColor: wrong ? theme.color.danger : theme.color.rule,
      };

  const change = (typed: string): void => {
    const code = digitsOf(typed);
    onChangeText(code);
    if (code.length === EMAIL_CODE_DIGITS && value.length < EMAIL_CODE_DIGITS) {
      onComplete(code);
    }
  };

  return (
    <View style={HOLDER}>
      <View
        style={BOXES}
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {PLACES.map((place) => (
          <View
            key={place}
            style={[
              BOX,
              box,
              focused && place === next ? focusRingStyle(theme, radius.control) : null,
            ]}
          >
            <Animated.View style={pulsing}>
              <Text
                role="numeralTitle"
                tone={locked ? 'disabled' : 'primary'}
                tabular={true}
                align="center"
              >
                {value.charAt(place)}
              </Text>
            </Animated.View>
          </View>
        ))}
      </View>
      {/* The hint as the web reads it: a description the input points at. */}
      <View nativeID={hintId} style={UNSEEN}>
        <Text role="caption">{hint}</Text>
      </View>
      <TextInput
        {...named}
        {...describedByProps(hintId, describedBy)}
        accessibilityHint={hint}
        style={[text, OVER]}
        value={value}
        onChangeText={change}
        inputMode="numeric"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        // No `maxLength`: the phone and the browser cut a paste to it before the change arrives, so
        // "12 34 56" would lose its last digits. The change keeps the first digits of what arrives,
        // and the input holds no more than the caller's value.
        caretHidden={true}
        editable={takesInput}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        testID={testID}
      />
    </View>
  );
}

/**
 * C-CodeField: the sign-in code. One unseen input behind a row of boxes takes the digits, typed,
 * pasted or filled in by the system; the boxes are decoration and the box of the next digit carries
 * the focus ring. A wrong code turns every border and plays the warning haptic; a locked field
 * takes the disabled look; while the code is checked the digits pulse.
 */
export function CodeField({
  label,
  value,
  onChangeText,
  onComplete,
  status,
  statusText,
  testID,
}: CodeFieldProps): JSX.Element {
  const before = useRef(status);

  useEffect(() => {
    // Once each time the code turns out wrong, and never for a field that is drawn wrong at first.
    if (status === 'wrong' && before.current !== 'wrong') {
      playHaptic('warning');
    }
    before.current = status;
  }, [status]);

  const failed = status === 'wrong' || status === 'locked';
  return (
    <FieldShell
      label={label}
      status={failed ? 'error' : 'none'}
      announce="alert"
      reserveLine={true}
      {...(failed && statusText !== null ? { statusText } : {})}
    >
      <Boxes
        value={value}
        onChangeText={onChangeText}
        onComplete={onComplete}
        status={status}
        testID={testID}
      />
    </FieldShell>
  );
}
