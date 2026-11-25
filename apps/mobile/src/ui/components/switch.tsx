import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import type { HapticName } from '@/ui/haptic';
import { usePulse } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { Pressable } from './pressable';
import { Text } from './text';

export type SwitchProps = {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  helper?: string;
  disabled?: boolean;
  /** The change is on its way: presses are ignored and the label is on the loading pulse. */
  busy?: boolean;
  testID: string;
};

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  minHeight: size.target,
  paddingVertical: space.x2,
};
const WORDS: ViewStyle = { flex: 1 };
const TRACK: ViewStyle = {
  width: size.switchTrack.width,
  height: size.switchTrack.height,
  borderWidth: rule.hairline,
  borderRadius: radius.control,
};
// The thumb stands `space.x1` from the track's outer edge, so inside the track's own hairline.
const THUMB_INSET = space.x1 - rule.hairline;
const THUMB: ViewStyle = {
  position: 'absolute',
  top: THUMB_INSET,
  width: size.switchThumb,
  height: size.switchThumb,
  borderRadius: radius.tag,
};
const THUMB_OFF: ViewStyle = { ...THUMB, left: THUMB_INSET };
const THUMB_ON: ViewStyle = { ...THUMB, right: THUMB_INSET };

const FLIP_HAPTIC: HapticName = 'selection';

/**
 * The label of a switch that is waiting, on the loading pulse (MO-loading). Under reduced motion it
 * is held at the pulse's low point, so the wait still looks unlike rest.
 */
function PulsingLabel({ children }: { children: ReactNode }): JSX.Element {
  const pulse = usePulse(true, 'held');
  return <Animated.View style={pulse}>{children}</Animated.View>;
}

/**
 * C-Switch: a setting that is on or off and takes effect at once, in a row at least as high as the
 * smallest target with the whole row the target. The track's fill and the thumb's place swap in one
 * frame (MO-cut): nothing slides and nothing fades. On is the ink track, never a color.
 */
export function Switch({
  value,
  onChange,
  label,
  helper,
  disabled = false,
  busy = false,
  testID,
}: SwitchProps): JSX.Element {
  const theme = useTheme();
  const track = disabled
    ? theme.color.disabledBg
    : value
      ? theme.color.inverseBg
      : theme.color.surface;
  const thumb = disabled
    ? theme.color.disabledText
    : value
      ? theme.color.inverseText
      : theme.color.text;
  const words = (
    <Text role="body" tone={disabled ? 'disabled' : 'primary'}>
      {label}
    </Text>
  );

  return (
    <Pressable
      role="switch"
      label={label}
      state={{ checked: value, busy }}
      feedback="moveAndFill"
      hover="fill"
      disabled={disabled}
      testID={testID}
      {...(helper === undefined ? {} : { hint: helper })}
      {...(busy
        ? {}
        : {
            haptic: FLIP_HAPTIC,
            onPress: () => {
              onChange(!value);
            },
          })}
    >
      <View style={ROW}>
        <View style={WORDS}>
          {busy ? <PulsingLabel>{words}</PulsingLabel> : words}
          {helper === undefined ? null : (
            <Text role="caption" tone={disabled ? 'disabled' : 'secondary'}>
              {helper}
            </Text>
          )}
        </View>
        <View
          style={[
            TRACK,
            {
              backgroundColor: track,
              // An on track and a disabled one have no outline of their own: the border takes the fill.
              borderColor: disabled || value ? track : theme.color.rule,
            },
          ]}
        >
          <View style={[value ? THUMB_ON : THUMB_OFF, { backgroundColor: thumb }]} />
        </View>
      </View>
    </Pressable>
  );
}
