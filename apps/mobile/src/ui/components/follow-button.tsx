import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useDoneStamp, WidthLock } from './action-row';
import { Button } from './button';

export type FollowButtonProps = {
  following: boolean;
  onToggle: () => void;
  /** The standard height (default) or the small one, for a row. */
  size?: 'md' | 'sm';
  /** The name the accessible label follows: "Follow Dana Okafor". */
  subject: string;
  /** The person or office followed: the done state stamps once for each press on it. */
  itemKey: string;
  testID: string;
};

// As wide as the wider of its two labels, wherever it stands.
const HUGS: ViewStyle = { alignSelf: 'flex-start' };

function FollowControl({
  following,
  onToggle,
  size = 'md',
  subject,
  testID,
}: FollowButtonProps): JSX.Element {
  const { t } = useTranslation('common');
  const stamp = useDoneStamp(following);
  const follow = t('ui.actions.follow');
  const done = t('ui.actions.following');
  // The haptic marks the commitment, never its undoing (MO-follow).
  const turning = following
    ? { accessibilityHint: t('ui.actions.unfollowHint') }
    : { haptic: 'medium' as const };
  return (
    <View style={HUGS}>
      <WidthLock
        size={size}
        twin={following ? { label: follow, done: false } : { label: done, done: true }}
      >
        <Animated.View style={stamp}>
          <Button
            variant={following ? 'primary' : 'secondary'}
            size={size}
            label={following ? done : follow}
            done={following}
            accessibilityLabel={
              following
                ? t('ui.actions.followingSubject', { name: subject })
                : t('ui.actions.followSubject', { name: subject })
            }
            selected={following}
            fullWidth={true}
            onPress={onToggle}
            testID={testID}
            {...turning}
          />
        </Animated.View>
      </WidthLock>
    </View>
  );
}

/**
 * C-FollowButton: Follow outside the action row. An outline button, and the ink button with the
 * check once following, at one width in both states so the row beside it never shifts. Turning on
 * stamps once (MO-follow); there is no third state and no color.
 */
export function FollowButton(props: FollowButtonProps): JSX.Element {
  // A button handed another subject starts again, so a done state it arrives with never stamps.
  return <FollowControl key={props.itemKey} {...props} />;
}
