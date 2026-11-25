import { typeRoles } from '@citizenrun/shared';
import { createContext, useContext, useId, useMemo } from 'react';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { usePulse } from '@/ui/motion';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { size, space } from '@/ui/tokens';

import { Icon } from './icon';
import { Text } from './text';

export type FieldShellProps = {
  label: string;
  /** Keeps the label as the control's name and drops it from the layout. */
  labelHidden?: boolean;
  helper?: string;
  status: 'none' | 'error' | 'valid';
  /** The sentence of the status; it takes the helper's place. */
  statusText?: string;
  /** 'alert': an error is said at once. 'polite': every change of the line is said at the next pause. */
  announce: 'alert' | 'polite';
  /** Draws the line even when it is empty, so what stands under the field does not move. */
  reserveLine?: boolean;
  /** At the right end of the line: a count. */
  trailingLine?: ReactNode;
  /** The helper is on the loading pulse: the field is waiting for an answer. */
  pulse?: boolean;
  children: ReactNode;
};

/** The props a control inside a FieldShell spreads to be named and described. */
export type FieldA11y = {
  accessibilityLabel: string;
  accessibilityHint: string | undefined;
  'aria-labelledby': string | undefined;
  describedBy: string | undefined;
};

/** What only the web reads of a description; React Native's own types leave the attribute out. */
export type DescribedByProps = { 'aria-describedby'?: string };

const NOT_IN_A_FIELD: FieldA11y = {
  accessibilityLabel: '',
  accessibilityHint: undefined,
  'aria-labelledby': undefined,
  describedBy: undefined,
};

const FieldContext = createContext<FieldA11y | null>(null);

/** A line with nothing to say still takes its height. */
const NO_BREAK_SPACE = '\u00A0';

const LABEL: ViewStyle = { marginBottom: space.x2 };
const LINE: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.x2 };
// The icon and the sentence start together, so the icon sits on the first line.
const WORDS: ViewStyle = { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: space.x1 };
const ICON_BOX: ViewStyle = { width: size.icon.small, justifyContent: 'center' };
const SENTENCE: ViewStyle = { flex: 1 };
const TRAILING: ViewStyle = { marginLeft: space.x3 };

/** The props a control inside a FieldShell spreads to be named and described. */
export function useFieldA11y(): FieldA11y {
  const field = useContext(FieldContext);
  if (field === null) {
    if (__DEV__) {
      throw new Error('useFieldA11y is read by a control inside a form field');
    }
    return NOT_IN_A_FIELD;
  }
  return field;
}

/** The ids of what describes a control, as the web's attribute takes them. */
export function describedByProps(...ids: readonly (string | undefined)[]): DescribedByProps {
  const given = ids.filter((id) => id !== undefined);
  return given.length === 0 ? {} : { 'aria-describedby': given.join(' ') };
}

/**
 * The label, the control and the one line under it that every field shares. The line holds the
 * helper, or the sentence of an error or a valid state behind its icon, which takes the helper's
 * place. The control inside reads its name and its description with `useFieldA11y`.
 */
export function FieldShell({
  label,
  labelHidden = false,
  helper,
  status,
  statusText,
  announce,
  reserveLine = false,
  trailingLine,
  pulse = false,
  children,
}: FieldShellProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const labelId = useId();
  const lineId = useId();
  const pulsing = usePulse(pulse, 'held');

  const verdict = status !== 'none' && statusText !== undefined ? status : 'none';
  const sentence = verdict === 'none' ? helper : statusText;
  const hasTrailing = trailingLine !== undefined && trailingLine !== null && trailingLine !== false;
  const drawsLine = sentence !== undefined || hasTrailing || reserveLine;
  // One line of the sentence at the text size in use: the icon is centered on it.
  const lineHeight = typeRoles.caption.lineHeight * theme.textScale * layout.fontScale;

  const a11y = useMemo<FieldA11y>(
    () => ({
      accessibilityLabel: label,
      accessibilityHint: sentence,
      'aria-labelledby': labelHidden ? undefined : labelId,
      describedBy: drawsLine ? lineId : undefined,
    }),
    [label, sentence, labelHidden, labelId, drawsLine, lineId],
  );

  const alerts = announce === 'alert' && verdict === 'error';
  const words =
    verdict === 'none' ? (
      <Animated.View style={[SENTENCE, pulsing]}>
        <Text role="caption" tone="secondary">
          {sentence ?? NO_BREAK_SPACE}
        </Text>
      </Animated.View>
    ) : (
      <View style={WORDS}>
        <View style={[ICON_BOX, { minHeight: lineHeight }]}>
          <Icon
            name={verdict === 'error' ? 'warning' : 'check'}
            size="small"
            tone={verdict === 'error' ? 'danger' : 'success'}
          />
        </View>
        <View style={SENTENCE}>
          <Text role="caption" tone={verdict === 'error' ? 'danger' : 'success'}>
            {sentence}
          </Text>
        </View>
      </View>
    );

  return (
    <FieldContext.Provider value={a11y}>
      <View>
        {labelHidden ? null : (
          <View nativeID={labelId} style={LABEL}>
            <Text role="label">{label}</Text>
          </View>
        )}
        {children}
        {drawsLine ? (
          <View
            // An error line is a new element, so a screen reader hears it as it appears.
            key={alerts ? 'alert' : 'line'}
            nativeID={lineId}
            style={LINE}
            role={alerts ? 'alert' : undefined}
            accessibilityLiveRegion={
              alerts ? 'assertive' : announce === 'polite' ? 'polite' : undefined
            }
            aria-live={announce === 'polite' ? 'polite' : undefined}
          >
            {words}
            {hasTrailing ? <View style={TRAILING}>{trailingLine}</View> : null}
          </View>
        ) : null}
      </View>
    </FieldContext.Provider>
  );
}
