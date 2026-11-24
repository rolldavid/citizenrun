import { useRef } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import { useFocusOnMount } from '@/ui/focus';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { size, space } from '@/ui/tokens';

import { Button } from './button';
import { Text } from './text';
import { Wordmark } from './wordmark';

export type SystemScreenProps = {
  /** One sentence: the screen's heading. */
  title: string;
  /** One line. */
  body?: string;
  action?: {
    label: string;
    onPress: () => void;
    variant: 'primary' | 'secondary';
    testID: string;
  };
  /** A quiet button under the first. */
  secondaryAction?: { label: string; onPress: () => void; testID: string };
  testID: string;
};

const ROOT: ViewStyle = { flex: 1 };
// A third of the way down; a tall text takes the room back before anything is cut.
const LEAD: ViewStyle = { height: '33%', flexShrink: 1 };
// Flush left, never centered.
const CONTENT: ViewStyle = { width: '100%', maxWidth: size.longForm, alignItems: 'flex-start' };
const TITLE: ViewStyle = { marginTop: space.x8 };
const BODY: ViewStyle = { marginTop: space.x2 };
const ACTION: ViewStyle = { marginTop: space.x6 };
const SECOND_ACTION: ViewStyle = { marginTop: space.x2 };

/**
 * C-SystemScreen: a full-screen state the app owns outright. The wordmark, one sentence, one line
 * and a button or two, flush left and a third of the way down, with no navigation, no drawing and
 * no way to dismiss it.
 */
export function SystemScreen({
  title,
  body,
  action,
  secondaryAction,
  testID,
}: SystemScreenProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const titleRef = useRef<TextInstance>(null);
  // A screen reader announces the screen by its heading.
  useFocusOnMount(titleRef);
  return (
    <View
      style={[ROOT, { backgroundColor: theme.color.bg, paddingHorizontal: layout.gutter }]}
      testID={testID}
    >
      <View style={LEAD} />
      <View style={CONTENT}>
        <Wordmark variant="wordmark" capHeight={size.wordmarkCap.rail} />
        <View style={TITLE}>
          <Text ref={titleRef} role="title" heading={1}>
            {title}
          </Text>
        </View>
        {body === undefined ? null : (
          <View style={BODY}>
            <Text role="body" tone="secondary">
              {body}
            </Text>
          </View>
        )}
        {action === undefined ? null : (
          <View style={ACTION}>
            <Button
              variant={action.variant}
              label={action.label}
              onPress={action.onPress}
              testID={action.testID}
            />
          </View>
        )}
        {secondaryAction === undefined ? null : (
          <View style={action === undefined ? ACTION : SECOND_ACTION}>
            <Button
              variant="quiet"
              label={secondaryAction.label}
              onPress={secondaryAction.onPress}
              testID={secondaryAction.testID}
            />
          </View>
        )}
      </View>
    </View>
  );
}
