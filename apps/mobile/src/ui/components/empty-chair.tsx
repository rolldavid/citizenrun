import { EmptyChairSvg } from '@citizenrun/cards';
import type { JSX } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/ui/theme';
import { size as sizeTokens } from '@/ui/tokens';

export type EmptyChairProps = {
  /** Default size.drawingEmpty: the drawing's width. */
  size?: number;
};

/**
 * C-EmptyChair: an empty chair in side view, in the theme's ink on the ground it stands on, with one
 * gray disc behind it and the seat as its one spot of the accent (D-539). Decorative: screen readers
 * skip it, and it never moves.
 */
export function EmptyChair({
  size: width = sizeTokens.drawingEmpty,
}: EmptyChairProps): JSX.Element {
  const { color } = useTheme();
  return (
    <View
      style={{ width }}
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      <EmptyChairSvg
        width={width}
        ink={color.text}
        paper={color.bg}
        tone={color.textSecondary}
        spot={color.accent}
        crop="trimmed"
      />
    </View>
  );
}
