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
// A value too long for the room beside its label goes under it, at the right, and wraps there,
// so the label always keeps its own words on its own line.
const SIDE_BY_SIDE: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  columnGap: space.x4,
  rowGap: space.x1,
};
const STACKED: ViewStyle = { gap: space.x1 };
// The label takes its own width, and gives way only where it is wider than the row by itself.
const LABEL: ViewStyle = { flexShrink: 1 };
// The value takes the rest of its line, at the right of it.
const VALUE_END: ViewStyle = { flexGrow: 1, flexShrink: 1, alignItems: 'flex-end' };
const VALUE_START: ViewStyle = { alignItems: 'flex-start' };
const WITH_CHEVRON: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };
const WORDS: ViewStyle = { flex: 1, minWidth: 0 };
// Out of the row's layout, so a word space takes no room in it.
const WORD_SPACE: ViewStyle = { position: 'absolute' };

/**
 * A space between the label and the value. Each stands in a box of its own with nothing between
 * them in the page's text, where the label's last word would run into the value's first word and
 * the row's text would not read as its name does. It draws nothing and no screen reader meets it.
 */
function WordSpace(): JSX.Element {
  return (
    <View style={WORD_SPACE}>
      <Text role="caption" hidden={true}>
        {' '}
      </Text>
    </View>
  );
}

/**
 * C-FactRow: a label and its value, on a soft rule. The row itself says "about" before an
 * estimate, at full contrast, and draws the unknown tag where the value is not known; it never
 * fades a value and never leaves a dash or a blank. At large text the value goes under its
 * label, from the left; a value too long to stand beside its label goes under it at the right.
 * With `onPress` the row is one target that opens the value's source.
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
      <WordSpace />
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
