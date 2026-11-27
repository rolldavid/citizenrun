import { BRAND } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, space } from '@/ui/tokens';

import { Text } from './text';

export type TagProps = {
  /** With `variant="unknown"` the label defaults to "not known yet". */
  label?: string;
  variant: 'outline' | 'solid' | 'unknown';
};

const BOX: ViewStyle = {
  alignSelf: 'flex-start',
  borderWidth: rule.hairline,
  borderRadius: radius.tag,
  paddingVertical: space.x1,
  paddingHorizontal: space.x2,
};

/**
 * C-Tag: the state of a person or a filing, and "not known yet". A mono label in a hairline box:
 * an outline, an inverted block for a verified filing, or a dashed outline for a value nobody
 * knows. It is never a target, never tilted and never colored.
 */
export function Tag({ label, variant }: TagProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const words = label ?? (variant === 'unknown' ? t('notKnownYet') : '');
  if (__DEV__ && words.toLowerCase().includes(BRAND.displayName.toLowerCase())) {
    throw new Error('A tag never carries the product name.');
  }
  const solid = variant === 'solid';
  const look: ViewStyle = solid
    ? { borderColor: theme.color.inverseBg, backgroundColor: theme.color.inverseBg }
    : variant === 'unknown'
      ? { borderColor: theme.color.rule, borderStyle: 'dashed' }
      : { borderColor: theme.color.rule };
  return (
    <View style={[BOX, look]}>
      <Text role="monoLabel" tone={solid ? 'inverse' : 'primary'} numberOfLines={1}>
        {words}
      </Text>
    </View>
  );
}
