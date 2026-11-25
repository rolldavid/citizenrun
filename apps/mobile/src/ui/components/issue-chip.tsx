import { useState } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { Icon } from './icon';
import { IssueTile } from './issue-tile';
import { Pressable } from './pressable';
import { Text } from './text';

export type IssueChipProps = {
  issueId: string;
  /** The short name printed on the chip. */
  name: string;
  /** 'md' (default): a control. 'sm': a display row on a page. */
  size?: 'md' | 'sm';
  selected?: boolean;
  /** Without it the chip is display-only and has no target. */
  onPress?: () => void;
  /** Sign-up only: the star a selected chip shows at its right end. */
  star?: { starred: boolean; onToggle: () => void; label: string } | null;
  /** The accessible name; the short name when absent. A caller that prints a short name passes the full one. */
  label?: string;
  testID: string;
};

const COVER: ViewStyle = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 };
// The chip's target lies under what the chip draws and is as large as the chip.
const TARGET_LAYER: ViewStyle = { ...COVER, justifyContent: 'center' };
const TILE_COLUMN: ViewStyle = { alignSelf: 'stretch', justifyContent: 'center' };
const LINE: ViewStyle = { alignSelf: 'stretch', width: rule.hairline };
const NAME: ViewStyle = {
  flexShrink: 1,
  justifyContent: 'center',
  paddingLeft: space.x3,
  // With the outline, the room a second line of the name needs.
  paddingVertical: space.x1 + rule.hairline,
};
const OUTLINE: ViewStyle = { ...COVER, borderWidth: rule.hairline, borderRadius: radius.control };
// Only in a cell of the grid, whose width is set: a part that grows where its parent's size is its
// content's is drawn as large as the room that parent was offered.
const FILLS_ITS_CELL: ViewStyle = { flexGrow: 1 };
// The selected tile's keyline stands one hairline inside the tile, clear of the chip's corners.
const TILE_RING: ViewStyle = {
  position: 'absolute',
  top: rule.hairline,
  right: 0,
  bottom: rule.hairline,
  left: rule.hairline,
  borderWidth: rule.hairline,
};
const TILE_KEYLINE: ViewStyle = { flex: 1, borderWidth: rule.hairline };
const STAR_ZONE: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: size.target,
  justifyContent: 'center',
};
// The star is drawn toward the chip's end of its target, and the name runs up to the drawing, not
// to the target's edge: a short column has no room to give away, and a name cut inside a word
// reads badly.
const STAR: ViewStyle = {
  width: size.target,
  height: size.target,
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingRight: space.x2,
};
const BESIDE_STAR = space.x2 + size.icon.medium + space.x1;

/**
 * What the drawn chip is told where a target lies under it: the target carries the name and takes
 * the presses, so the drawing is passed through by a pointer and skipped by a screen reader.
 */
const UNDER_ITS_TARGET = {
  pointerEvents: 'none',
  'aria-hidden': true,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

function Chip({
  issueId,
  name,
  size: sizeName = 'md',
  selected = false,
  onPress,
  star,
  label,
  testID,
  fills,
}: IssueChipProps & { fills: boolean }): JSX.Element {
  const theme = useTheme();
  // C-Pressable takes its size from what it holds, so the target is given the chip's own height.
  const [height, setHeight] = useState<number | null>(null);
  const least = sizeName === 'sm' ? size.chipSmall : size.chip;
  const paint = theme.issue(issueId);
  const starred = selected && star !== undefined && star !== null ? star : null;
  const pressable = onPress !== undefined;

  const root: ViewStyle = {
    // A row, so the drawing is as high as the chip by stretching.
    flexDirection: 'row',
    minHeight: least,
    borderRadius: radius.control,
    backgroundColor: selected ? theme.color.selectedBg : theme.color.surface,
    // In a row the chip is as wide as its name; in a cell of the grid it fills the cell.
    ...(fills ? { flexGrow: 1, flexShrink: 1 } : { maxWidth: '100%' }),
  };
  const box: ViewStyle = {
    flexShrink: 1,
    flexDirection: 'row',
    borderRadius: radius.control,
    overflow: 'hidden',
    ...(fills ? FILLS_ITS_CELL : {}),
  };
  const drawn = (
    <View style={box} {...(pressable ? UNDER_ITS_TARGET : {})}>
      <View
        style={[
          TILE_COLUMN,
          { width: least, backgroundColor: paint === null ? theme.color.well : paint.fill },
        ]}
      >
        <IssueTile issueId={issueId} size={sizeName === 'sm' ? 'chipSmall' : 'chip'} />
        {selected ? (
          <View style={[TILE_RING, { borderColor: theme.color.selectedBg }]}>
            <View style={[TILE_KEYLINE, { borderColor: theme.color.selectedText }]} />
          </View>
        ) : null}
      </View>
      <View
        style={[LINE, { backgroundColor: selected ? theme.color.selectedBg : theme.color.rule }]}
      />
      <View
        style={[
          NAME,
          fills ? FILLS_ITS_CELL : null,
          { paddingRight: starred === null ? space.x3 : BESIDE_STAR },
          // An inverted chip keeps its ground under a pointer: the fill belongs to the plain one.
          selected ? { backgroundColor: theme.color.selectedBg } : null,
        ]}
      >
        <Text
          role="label"
          tone={selected ? 'inverse' : 'primary'}
          // In a row a name keeps to two lines. In the grid the row grows with its name, so a name
          // is never cut where a person chooses by it.
          {...(fills ? {} : { numberOfLines: 2 })}
        >
          {name}
        </Text>
      </View>
    </View>
  );

  return (
    <View
      style={root}
      {...(pressable
        ? {
            onLayout: (event: LayoutChangeEvent) => {
              setHeight(event.nativeEvent.layout.height);
            },
          }
        : // A display chip has no target to carry its id.
          { testID })}
    >
      {onPress === undefined ? null : (
        <View style={TARGET_LAYER}>
          <Pressable
            role="checkbox"
            label={label ?? name}
            state={{ checked: selected }}
            haptic="selection"
            hover="fill"
            feedback="fill"
            radius={radius.control}
            testID={testID}
            onPress={onPress}
          >
            <View style={{ height: height ?? least }} />
          </Pressable>
        </View>
      )}
      {drawn}
      {/* Round the chip, not round the drawing: a chip its row stretches keeps one outline. */}
      <View
        style={[OUTLINE, { borderColor: selected ? theme.color.selectedBg : theme.color.rule }]}
        pointerEvents="none"
      />
      {starred === null ? null : (
        // Beside the chip's target, never inside it: a press on the star is the star's alone.
        <View style={STAR_ZONE}>
          <Pressable
            role="checkbox"
            label={starred.label}
            state={{ checked: starred.starred }}
            haptic="selection"
            testID={`${testID}-star`}
            onPress={starred.onToggle}
          >
            <View style={STAR}>
              <Icon name={starred.starred ? 'starFilled' : 'star'} size="medium" tone="inverse" />
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/**
 * C-IssueChip: an issue as a control, or as a display chip with no `onPress`. A box with the
 * issue's tile flush at its left and the short name beside it. Selected inverts the box and keeps
 * the tile's color inside a keyline; a state change cuts. The issue color is never the chip's fill
 * or its text. In a row the chip is as wide as its name needs.
 */
export function IssueChip(props: IssueChipProps): JSX.Element {
  return <Chip {...props} fills={false} />;
}

/**
 * The chip as a cell of C-IssueGrid: it fills its cell, so the two chips of a row are one height,
 * and its name takes the lines it needs. Internal to the design system.
 */
export function IssueGridChip(props: IssueChipProps): JSX.Element {
  return <Chip {...props} fills={true} />;
}
