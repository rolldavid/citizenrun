import { IssueIconSvg } from '@citizenrun/cards';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { isIssueId, radius, rule, size } from '@/ui/tokens';

import { useHoverGround } from './hover-ground';
import { Icon } from './icon';
import type { IconSize } from './icon';

export type IssueTileProps = {
  issueId: string;
  /** 'tile' (default): for tight places. 'chip' and 'chipSmall': only inside C-IssueChip. */
  size?: 'tile' | 'chip' | 'chipSmall';
  /** A hairline round the tile; required on a hovered or pressed ground. */
  keyline?: boolean;
  /** Inside C-IssueChip, whose own box and line stand round the tile: an unknown issue draws no keyline of its own. */
  bare?: boolean;
  /** The issue's name, where it is not printed beside the tile. Without it the tile is hidden from screen readers. */
  label?: string;
};

/** The side of the square and the size of the icon in it. */
const SIZES: Readonly<
  Record<NonNullable<IssueTileProps['size']>, { side: number; icon: IconSize }>
> = {
  tile: { side: size.issueTile, icon: 'small' },
  chip: { side: size.chip, icon: 'medium' },
  chipSmall: { side: size.chipSmall, icon: 'small' },
};

/**
 * C-IssueTile: an issue's color with its icon, the only place an issue color fills a shape. A
 * square, never round and never without its icon. An id this build does not know draws a neutral
 * tile with a keyline and the tag icon (PC6A-25).
 */
export function IssueTile({
  issueId,
  size: sizeName = 'tile',
  keyline = false,
  bare = false,
  label,
}: IssueTileProps): JSX.Element {
  const theme = useTheme();
  const onHoverGround = useHoverGround();
  if (__DEV__ && onHoverGround && !keyline) {
    throw new Error('An issue tile on a hovered ground needs its keyline');
  }
  const { side, icon } = SIZES[sizeName];
  const known = isIssueId(issueId) ? issueId : null;
  const paint = known === null ? null : theme.issue(known);
  const outlined = keyline || (paint === null && !bare);
  const square: ViewStyle = {
    width: side,
    height: side,
    borderRadius: radius.none,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: paint === null ? theme.color.well : paint.fill,
    ...(outlined ? { borderWidth: rule.hairline, borderColor: theme.color.rule } : {}),
  };
  const glyph =
    known !== null && paint !== null ? (
      <IssueIconSvg id={known} size={size.icon[icon]} fill={paint.on} />
    ) : (
      <Icon name="tag" size={icon} tone="primary" />
    );

  if (label === undefined) {
    return (
      <View
        style={square}
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {glyph}
      </View>
    );
  }
  // `accessible` makes the labelled tile one element for the phone's screen reader.
  return (
    <View style={square} accessible={true} role="img" aria-label={label}>
      {glyph}
    </View>
  );
}
