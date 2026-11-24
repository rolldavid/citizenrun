import type { JSX } from 'react';
import { View } from 'react-native';

import type { HapticName } from '@/ui/haptic';
import type { IconName } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';
import type { ResolvedTone } from '@/ui/tone';

import { CountBadge } from './count-badge';
import { Icon } from './icon';
import { Pressable } from './pressable';

export type IconButtonProps = {
  icon: IconName;
  /** Drawn in place of `icon` while `selected`: the same shape, filled. */
  selectedIcon?: IconName;
  selected?: boolean;
  /** Default 'plain': no outline. 'framed': a hairline outline. 'primary': the ink fill. */
  variant?: 'plain' | 'framed' | 'primary';
  /** The full target around a standard icon (default), or the small drawing around a medium icon. */
  size?: 'md' | 'sm';
  /** The accessible name. It carries the count when there is a badge. */
  label: string;
  /** An unread count on the top-right corner. */
  badge?: number;
  disabled?: boolean;
  onPress?: () => void;
  href?: string;
  haptic?: HapticName;
  testID: string;
};

/**
 * C-IconButton: an action shown as an icon. A toggled button swaps its icon for the selected one
 * and never changes color.
 */
export function IconButton({
  icon,
  selectedIcon,
  selected = false,
  variant = 'plain',
  size: sizeName = 'md',
  label,
  badge,
  disabled = false,
  onPress,
  href,
  haptic,
  testID,
}: IconButtonProps): JSX.Element {
  const theme = useTheme();
  const small = sizeName === 'sm';
  const side = small ? size.buttonSmall : size.target;
  const tone: ResolvedTone = disabled ? 'disabled' : variant === 'primary' ? 'inverse' : 'primary';

  const fillFor = (hovered: boolean, swapsFill: boolean): string | null => {
    if (disabled) {
      // A plain button has no outline and no fill to give up: its icon alone turns.
      return variant === 'plain' ? null : theme.color.disabledBg;
    }
    if (variant === 'primary') {
      return hovered || swapsFill ? theme.color.inverseHover : theme.color.inverseBg;
    }
    // Under reduced motion a press on the plain button still shows (PC6A-21); C-Pressable paints
    // the framed one.
    return variant === 'plain' && swapsFill ? theme.color.pressedBg : null;
  };

  return (
    // The box keeps the press target, and with it the fills and the focus ring, to the drawing.
    <View style={{ width: side, height: side }}>
      <Pressable
        role={href === undefined ? 'button' : 'link'}
        label={label}
        disabled={disabled}
        testID={testID}
        radius={radius.control}
        feedback={variant === 'framed' ? 'moveAndFill' : 'move'}
        hover={variant === 'primary' ? 'none' : 'fill'}
        {...(selectedIcon === undefined ? {} : { state: { selected } })}
        {...(small ? { drawn: { width: side, height: side } } : {})}
        {...(onPress === undefined ? {} : { onPress })}
        {...(href === undefined ? {} : { href })}
        {...(haptic === undefined ? {} : { haptic })}
      >
        {({ hovered, swapsFill }) => {
          const fill = fillFor(hovered, swapsFill);
          return (
            <View
              style={[
                {
                  width: side,
                  height: side,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.control,
                },
                // Disabled, the framed button gives up its outline for the disabled fill.
                variant === 'framed' && !disabled
                  ? { borderWidth: rule.hairline, borderColor: theme.color.rule }
                  : null,
                fill === null ? null : { backgroundColor: fill },
              ]}
            >
              <Icon
                name={selected ? (selectedIcon ?? icon) : icon}
                size={small ? 'medium' : 'standard'}
                tone={tone}
              />
              {badge === undefined ? null : (
                <View
                  style={{
                    position: 'absolute',
                    top: small ? 0 : space.x1,
                    right: small ? 0 : space.x1,
                  }}
                  pointerEvents="none"
                >
                  <CountBadge count={badge} size="corner" />
                </View>
              )}
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
