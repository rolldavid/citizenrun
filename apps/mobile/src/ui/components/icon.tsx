import { useContext } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';

import { ICONS } from '@/ui/icons';
import type { IconName } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { size } from '@/ui/tokens';
import { ToneContext, toneColor } from '@/ui/tone';
import type { TextTone } from '@/ui/tone';

export type IconSize = 'small' | 'medium' | 'standard';

export type IconProps = {
  name: IconName;
  /** Default 'standard'. */
  size?: IconSize;
  /** Default 'inherit': the tone of the C-Text around it, and 'primary' outside any. */
  tone?: TextTone;
  /** The accessible name. Without it the icon is hidden from screen readers. */
  label?: string;
};

/**
 * C-Icon: one interface icon at a `size.icon` size, in one color, the tone's. A tone is the only
 * way to color it, so it never draws in the accent, in volt or in an issue color. It takes no
 * presses: the control around it does.
 */
export function Icon({
  name,
  size: sizeName = 'standard',
  tone = 'inherit',
  label,
}: IconProps): JSX.Element {
  const theme = useTheme();
  const inherited = useContext(ToneContext);
  const resolved = tone === 'inherit' ? (inherited ?? 'primary') : tone;
  const px = size.icon[sizeName];
  const Glyph = ICONS[name];
  const glyph = <Glyph px={px} color={toneColor(theme.color, resolved)} />;
  const box = { width: px, height: px };

  if (label === undefined) {
    return (
      <View
        style={box}
        pointerEvents="none"
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {glyph}
      </View>
    );
  }
  // `accessible` makes the labelled icon one element for the phone's screen reader.
  return (
    <View style={box} pointerEvents="none" accessible={true} role="img" aria-label={label}>
      {glyph}
    </View>
  );
}
