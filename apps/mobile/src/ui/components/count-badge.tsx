import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, size, space } from '@/ui/tokens';

import { Text } from './text';

/** The largest count a badge writes out. */
const MAX_COUNT = 99;

export type CountBadgeProps = {
  count: number;
  /** Default 'corner': on an icon's corner. 'row': at the end of a rail row. */
  size?: 'corner' | 'row';
};

/**
 * C-CountBadge: an unread count. It draws nothing for a count of zero and stops counting above
 * MAX_COUNT. Hidden from screen readers: the control it sits on carries the count in its label.
 */
export function CountBadge({
  count,
  size: sizeName = 'corner',
}: CountBadgeProps): JSX.Element | null {
  const theme = useTheme();
  const { t } = useTranslation('common');
  if (!(count > 0)) {
    return null;
  }
  const side = sizeName === 'row' ? size.badgeRow : size.badge;
  return (
    // The row keeps the badge as wide as its digits wherever it is placed.
    <View
      style={{ flexDirection: 'row', alignItems: 'center' }}
      pointerEvents="none"
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      <View
        style={{
          minWidth: side,
          minHeight: side,
          borderRadius: radius.full,
          backgroundColor: theme.color.inverseBg,
          paddingHorizontal: space.x1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text role="mono" tone="inverse" tabular>
          {count > MAX_COUNT ? t('ui.badge.overflow') : String(count)}
        </Text>
      </View>
    </View>
  );
}
