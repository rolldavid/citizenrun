import { DistrictShapeSvg } from '@citizenrun/cards';
import { assertNever } from '@citizenrun/shared';
import type { DistrictRef, OutlineInput, TFunction } from '@citizenrun/shared';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { rule, size, space } from '@/ui/tokens';

import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

export type MiniMapStillProps = {
  /** The district's outline; null draws the empty square. */
  outline: OutlineInput | null;
  /** The district's name. */
  placeName: string;
  /** The level's name, already translated. */
  levelLabel: string;
  /** Set when the district's shape is not exact. */
  approximateText: string | null;
  /** The row's accessible name when it can be pressed. */
  openLabel: string;
  /** Null where the row opens nothing, and when there is no outline. */
  onPress: (() => void) | null;
  testID: string;
};

/** The name of a district's level. */
function levelLabelOf(level: DistrictRef['level'], t: TFunction): string {
  switch (level) {
    case 'local':
      return t('explore:map.levelLocal');
    case 'county':
      return t('explore:map.levelCounty');
    case 'state':
      return t('explore:map.levelState');
    case 'federal':
      return t('explore:map.levelFederal');
    case 'special':
      return t('explore:map.levelSpecial');
    default:
      return assertNever(level);
  }
}

/** The three strings a caller passes to MiniMapStill for a district (MAP-strings). */
export function miniMapText(
  district: Pick<DistrictRef, 'name' | 'level' | 'geometryQuality'>,
  t: TFunction,
): Pick<MiniMapStillProps, 'levelLabel' | 'approximateText' | 'openLabel'> {
  return {
    levelLabel: levelLabelOf(district.level, t),
    // A shape that is not the district's own says so (D-210).
    approximateText: district.geometryQuality === 'exact' ? null : t('explore:map.miniApproximate'),
    openLabel: t('explore:map.miniOpen', { place: district.name }),
  };
}

/** The room between the square's edge and the shape, keyline included. */
const INSET = space.x2;
/** The side of the shape's box. */
const SHAPE = size.miniMap - 2 * INSET;

const ROW: ViewStyle = { flexDirection: 'row', alignItems: 'center', minHeight: size.target };
const SQUARE: ViewStyle = {
  width: size.miniMap,
  height: size.miniMap,
  borderWidth: rule.hairline,
  // The keyline stands inside the square, so the room takes it back.
  padding: INSET - rule.hairline,
};
const WORDS: ViewStyle = { flex: 1, minWidth: 0, marginLeft: space.x3 };
const CHEVRON: ViewStyle = { marginLeft: space.x2 };

/**
 * MAP-mini-map: where an office is, as a still. The district as one solid shape in a keylined
 * square, beside its name and its level. It draws our own shape alone: no base map, no map
 * library and no credit (D-207). The row is a target, with its chevron, only where it opens
 * something.
 */
export function MiniMapStill({
  outline,
  placeName,
  levelLabel,
  approximateText,
  openLabel,
  onPress,
  testID,
}: MiniMapStillProps): JSX.Element {
  const theme = useTheme();
  // With no outline there is nothing to show on a map.
  const press = outline === null ? null : onPress;
  const opens = press !== null;
  const row = (
    <View style={ROW}>
      {/* The square is a picture of what the words beside it name. */}
      <View
        style={[
          SQUARE,
          { backgroundColor: theme.color.surface, borderColor: theme.color.ruleSoft },
        ]}
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {outline === null ? null : (
          // Only path data is read from the outline; a string that is anything else draws nothing.
          <DistrictShapeSvg
            svg={outline.svg}
            bbox={outline.bbox}
            size={SHAPE}
            fill={theme.color.text}
          />
        )}
      </View>
      <View style={WORDS}>
        <Text role="label">{placeName}</Text>
        <Text role="caption">{levelLabel}</Text>
        {approximateText === null ? null : <Text role="caption">{approximateText}</Text>}
      </View>
      {opens ? (
        <View style={CHEVRON}>
          <Icon name="chevronRight" size="small" tone="secondary" />
        </View>
      ) : null}
    </View>
  );

  if (press === null) {
    return <View testID={testID}>{row}</View>;
  }
  return (
    <Pressable
      role="button"
      label={openLabel}
      feedback="move"
      hover="fill"
      testID={testID}
      onPress={press}
    >
      {row}
    </Pressable>
  );
}
