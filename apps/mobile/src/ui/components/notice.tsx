import { assertNever, typeRoles } from '@citizenrun/shared';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { IconName } from '@/ui/icons';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { radius, size, space } from '@/ui/tokens';

import { Button } from './button';
import { Icon } from './icon';
import { Text } from './text';

export type NoticeProps = {
  kind: 'info' | 'warning' | 'error';
  /** One sentence. It says the kind in its words: the icon is not read out. */
  text: string;
  /** In place of the kind's own icon. */
  icon?: IconName;
  action?: { label: string; onPress: () => void; testID: string };
  testID?: string;
};

const BOX: ViewStyle = { gap: space.x3, padding: space.x3, borderRadius: radius.control };
// The action at the right, at the middle of the sentence.
const BESIDE: ViewStyle = { flexDirection: 'row', alignItems: 'center' };
// The action under the sentence.
const STACKED: ViewStyle = { alignItems: 'flex-start' };
// The icon and the sentence start together, so the icon sits on the first line.
const WORDS: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', gap: space.x3 };
const WORDS_BESIDE: ViewStyle = { flex: 1 };
const WORDS_STACKED: ViewStyle = { alignSelf: 'stretch' };
const ICON_BOX: ViewStyle = { width: size.icon.medium, justifyContent: 'center' };
const SENTENCE: ViewStyle = { flex: 1 };
// Under the sentence's first letter, past the icon.
const ACTION_STACKED: ViewStyle = { marginLeft: size.icon.medium + space.x3 };

function iconOf(kind: NoticeProps['kind']): IconName {
  switch (kind) {
    case 'info':
      return 'info';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return assertNever(kind);
  }
}

/**
 * C-Notice: an inline block for information, a warning or an error. Every kind stands on the same
 * flat ground, with no border and no tint; an error sets its icon and its words in the danger
 * color. A screen reader hears a warning or an error at once, and information at its next pause.
 */
export function Notice({ kind, text, icon, action, testID }: NoticeProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const tone = kind === 'error' ? 'danger' : 'primary';
  const stacked = layout.isNarrow && action !== undefined;
  // One line of the sentence at the text size in use: the icon is centered on it.
  const line = typeRoles.body.lineHeight * theme.textScale * layout.fontScale;
  return (
    <View
      style={[BOX, stacked ? STACKED : BESIDE, { backgroundColor: theme.color.noticeBg }]}
      role={kind === 'info' ? 'status' : 'alert'}
      testID={testID}
    >
      <View style={[WORDS, stacked ? WORDS_STACKED : WORDS_BESIDE]}>
        <View style={[ICON_BOX, { minHeight: line }]}>
          <Icon name={icon ?? iconOf(kind)} size="medium" tone={tone} />
        </View>
        <View style={SENTENCE}>
          <Text role="body" tone={tone}>
            {text}
          </Text>
        </View>
      </View>
      {action === undefined ? null : (
        <View style={stacked ? ACTION_STACKED : null}>
          <Button
            variant="secondary"
            size="sm"
            label={action.label}
            onPress={action.onPress}
            testID={action.testID}
          />
        </View>
      )}
    </View>
  );
}
