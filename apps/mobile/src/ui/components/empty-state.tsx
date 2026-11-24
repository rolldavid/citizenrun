import { useRef } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import { useFocusOnMount } from '@/ui/focus';
import { size, space } from '@/ui/tokens';

import { Button } from './button';
import { EmptyChair } from './empty-chair';
import { Text } from './text';

export type EmptyStateProps = {
  /**
   * Default 'empty'. 'error': the same layout, and the button reads "Try again" whatever
   * `action.label` holds.
   */
  kind?: 'empty' | 'error';
  /** Default 'chair'. 'none' drops the drawing: inside a sheet, a side panel or the right column. */
  art?: 'chair' | 'none';
  /** One sentence. */
  title: string;
  /** One line. */
  body?: string;
  /** The next step: the one button. */
  action?: {
    label: string;
    onPress?: () => void;
    href?: string;
    /** Default 'primary'. */
    variant?: 'primary' | 'secondary';
    testID: string;
  };
  /**
   * Default 2. 1 on a screen with no title of its own: the title is then the screen's heading and
   * takes focus when it mounts.
   */
  headingLevel?: 1 | 2;
  testID?: string;
};

// Flush left, never centered.
const ROOT: ViewStyle = { alignItems: 'flex-start', paddingVertical: space.x6 };
const ART: ViewStyle = { marginBottom: space.x6 };
const BODY: ViewStyle = { marginTop: space.x2 };
const ACTION: ViewStyle = { marginTop: space.x6 };

/**
 * C-EmptyState: says what belongs here and offers the next step; also the generic error. The empty
 * chair, one sentence, one line and one button at most, flush left. The chair's seat is its only
 * accent.
 */
export function EmptyState({
  kind = 'empty',
  art = 'chair',
  title,
  body,
  action,
  headingLevel = 2,
  testID,
}: EmptyStateProps): JSX.Element {
  const { t } = useTranslation('common');
  const titleRef = useRef<TextInstance>(null);
  // Only a level 1 title is handed the ref, so nothing takes focus at level 2.
  useFocusOnMount(titleRef);
  return (
    <View style={ROOT} testID={testID}>
      {art === 'chair' ? (
        <View style={ART}>
          <EmptyChair size={size.drawingEmpty} />
        </View>
      ) : null}
      <Text role="title" heading={headingLevel} {...(headingLevel === 1 ? { ref: titleRef } : {})}>
        {title}
      </Text>
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
            variant={action.variant ?? 'primary'}
            label={kind === 'error' ? t('ui.retry') : action.label}
            testID={action.testID}
            {...(action.onPress === undefined ? {} : { onPress: action.onPress })}
            {...(action.href === undefined ? {} : { href: action.href })}
          />
        </View>
      )}
    </View>
  );
}
