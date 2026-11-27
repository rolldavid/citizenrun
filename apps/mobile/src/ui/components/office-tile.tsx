import { OfficeGlyphSvg } from '@citizenrun/cards';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { IconName } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { radius, size } from '@/ui/tokens';

import { Icon } from './icon';
import type { IconSize } from './icon';

export type OfficeTileProps = {
  /** The office type's illustration id; null where the caller has no office type. */
  illustration: string | null;
  /** Replaces the glyph with an interface icon: the two prompt cards only. */
  icon?: IconName;
  /** sm: tagged rows. md: headers and rows. lg: share cards and the map sheet. */
  size: 'sm' | 'md' | 'lg';
  /** Default true without a label: hidden from screen readers. */
  decorative?: boolean;
  /** The accessible name of a tile that stands for its office by itself. */
  label?: string;
};

/** The interface icon nearest 60% of each tile. */
const ICON_SIZE: Readonly<Record<OfficeTileProps['size'], IconSize>> = {
  sm: 'small',
  md: 'medium',
  lg: 'standard',
};

const CENTERED: ViewStyle = { alignItems: 'center', justifyContent: 'center' };

/**
 * C-OfficeTile: an office, always square. An ink tile with the office's one-color glyph at 60% of
 * its side; with neither a glyph nor an icon it is the plain tile. It is never round, never takes
 * an issue color and never holds the large drawing.
 */
export function OfficeTile({
  illustration,
  icon,
  size: sizeName,
  decorative,
  label,
}: OfficeTileProps): JSX.Element {
  const theme = useTheme();
  const side = size.officeTile[sizeName];
  const tile: ViewStyle = {
    ...CENTERED,
    width: side,
    height: side,
    borderRadius: radius.control,
    backgroundColor: theme.color.inverseBg,
  };
  const mark =
    icon !== undefined ? (
      <Icon name={icon} size={ICON_SIZE[sizeName]} tone="inverse" />
    ) : illustration === null ? null : (
      <OfficeGlyphSvg
        id={illustration}
        size={size.officeGlyph[sizeName]}
        fill={theme.color.inverseText}
      />
    );

  // A tile with no name has nothing to say, whatever the caller asks.
  if (label === undefined || (decorative ?? false)) {
    return (
      <View
        style={tile}
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {mark}
      </View>
    );
  }
  // `accessible` makes the tile one element for the phone's screen reader.
  return (
    <View style={tile} accessible={true} role="img" aria-label={label}>
      {mark}
    </View>
  );
}
