import { MONOGRAM, WORDMARK, WordmarkSvg } from '@citizenrun/cards';
import { BRAND } from '@citizenrun/shared';
import type { JSX } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/ui/theme';
import { size } from '@/ui/tokens';

export type WordmarkProps = {
  variant: 'wordmark' | 'monogram';
  /** The height of the capitals: one of size.wordmarkCap, or size.monogramRail. */
  capHeight: number;
  /** Default 'primary'. 'inverse': on an ink ground. */
  tone?: 'primary' | 'inverse';
};

/**
 * C-Wordmark: the typeset name, or its two letters, as outlines in one color, the tone's. It draws
 * no room around itself: the caller keeps one cap height clear on every side, and a bar's own ground
 * counts as clear space. Screen readers hear the name once, as an image.
 */
export function Wordmark({ variant, capHeight, tone = 'primary' }: WordmarkProps): JSX.Element {
  const theme = useTheme();
  if (__DEV__ && capHeight < size.wordmarkCap.minimum) {
    throw new Error('Wordmark cap height is under the minimum');
  }
  const outline = variant === 'wordmark' ? WORDMARK : MONOGRAM;
  const fill = tone === 'inverse' ? theme.color.inverseText : theme.color.text;
  return (
    // The box is the drawing's own, so the mark sits where its caller places it and never stretches.
    // `accessible` makes the mark one element for the phone's screen reader.
    <View
      style={{ width: (capHeight * outline.width) / outline.height, height: capHeight }}
      accessible={true}
      role="img"
      accessibilityLabel={BRAND.displayName}
    >
      <WordmarkSvg variant={variant} capHeight={capHeight} fill={fill} />
    </View>
  );
}
