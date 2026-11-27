import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { DisplayValue } from '@/ui/display-value';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, textScale } from '@/ui/tokens';

import { Icon } from './icon';
import { Pressable } from './pressable';
import { Tag } from './tag';
import { Text } from './text';

export type FactRowProps = {
  label: string;
  value: DisplayValue;
  /** Opens the value's source: the whole row is then one target. */
  onPress?: () => void;
  /** Required with `onPress`. */
  testID?: string;
};

const FRAME: ViewStyle = { borderTopWidth: rule.hairline, paddingVertical: space.x3 };
const TARGET: ViewStyle = { minHeight: size.target, justifyContent: 'center' };
const SIDE_BY_SIDE: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', gap: space.x4 };
const STACKED: ViewStyle = { gap: space.x1 };
// The label keeps the room its value leaves; both give way when the two do not fit one line.
const LABEL: ViewStyle = { flexGrow: 1, flexShrink: 1 };
const VALUE_END: ViewStyle = { flexShrink: 1, alignItems: 'flex-end' };
const VALUE_START: ViewStyle = { alignItems: 'flex-start' };
const WITH_CHEVRON: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };
const WORDS: ViewStyle = { flex: 1, minWidth: 0 };

/**
 * C-FactRow: a label and its value, on a soft rule. The row itself says "about" before an
 * estimate, at full contrast, and draws the unknown tag where the value is not known; it never
 * fades a value and never leaves a dash or a blank. At large text the value goes under its
 * label. With `onPress` the row is one target that opens the value's source.
 */
export function FactRow({ label, value, onPress, testID }: FactRowProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const { t } = useTranslation('common');
  if (__DEV__ && onPress !== undefined && testID === undefined) {
    throw new Error('A pressable fact row needs a testID.');
  }
  const stacked = Math.max(layout.fontScale, theme.textScale) >= textScale.tightFrom;
  const drawn =
    value.text === null ? null : value.about ? t('aboutValue', { value: value.text }) : value.text;

  const facts = (
    <View style={stacked ? STACKED : SIDE_BY_SIDE}>
      <View style={stacked ? null : LABEL}>
        <Text role="body" tone="secondary">
          {label}
        </Text>
      </View>
      <View style={stacked ? VALUE_START : VALUE_END}>
        {drawn === null ? (
          <Tag variant="unknown" />
        ) : (
          <Text role="bodyStrong" align={stacked ? 'start' : 'end'}>
            {drawn}
          </Text>
        )}
      </View>
    </View>
  );
  const frame: ViewStyle = { ...FRAME, borderTopColor: theme.color.ruleSoft };

  if (onPress === undefined) {
    return (
      <View style={frame} testID={testID}>
        {facts}
      </View>
    );
  }
  return (
    <Pressable
      role="button"
      label={t('ui.factRow.label', { label, value: drawn ?? t('notKnownYet') })}
      feedback="fill"
      hover="fill"
      radius={radius.none}
      testID={testID ?? ''}
      onPress={onPress}
    >
      <View style={[frame, TARGET]}>
        <View style={WITH_CHEVRON}>
          <View style={WORDS}>{facts}</View>
          <Icon name="chevronRight" size="small" tone="secondary" />
        </View>
      </View>
    </Pressable>
  );
}
