import { assertNever, typeRoles } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { DimensionValue, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { usePulse } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { radius, size, space } from '@/ui/tokens';

export type SkeletonProps = {
  shape: 'block' | 'circle' | 'line' | 'card' | 'row' | 'canvas' | 'cell';
  /** Of a 'block' or a 'cell'. Default 'full': as wide as its parent. */
  width?: number | 'full';
  /** Of a 'block'. Default size.listRowMin. */
  height?: number;
  /** Of a 'line'. Default 1. */
  lines?: number;
};

/** A text bar is this share of the line of text it stands for. */
const LINE_SHARE = 0.6;
const LINE_HEIGHT = typeRoles.body.lineHeight * LINE_SHARE;
/** The height of one text bar: what a `block` takes to stand for a few words of `body` text. */
export const SKELETON_TEXT_BAR = LINE_HEIGHT;
/** The last bar of a paragraph stops short, as a last line does. */
const LAST_LINE = '60%';
/** The two short bars beside a card's avatar: a name and a line under it. */
const CARD_HEADER_LINES = ['40%', '25%'] as const;

const FULL = '100%';
const LINES: ViewStyle = { gap: space.x2 };
const HEADER: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x3 };
const HEADER_LINES: ViewStyle = { flex: 1, gap: space.x2 };
const CARD: ViewStyle = { gap: space.x2 };
const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  minHeight: size.listRowMin,
  paddingVertical: space.x2,
};
const CIRCLE: ViewStyle = {
  width: size.avatar.sm,
  height: size.avatar.sm,
  borderRadius: radius.full,
};
const CANVAS: ViewStyle = { width: FULL, aspectRatio: 4 / 5, borderRadius: radius.none };

function bar(width: DimensionValue): ViewStyle {
  return { width, height: LINE_HEIGHT, borderRadius: radius.none };
}

/** The widths of a paragraph's bars: every one full but the last. */
function paragraph(count: number): DimensionValue[] {
  const whole = Math.max(1, Math.floor(count));
  return Array.from({ length: whole }, (_, index) => (index === whole - 1 ? LAST_LINE : FULL));
}

/** How wide the skeleton stands in its parent: at a given width, at its own, or across it. */
function frameOf(shape: SkeletonProps['shape'], width: SkeletonProps['width']): ViewStyle {
  if (shape === 'circle') {
    return { alignSelf: 'flex-start' };
  }
  if ((shape === 'block' || shape === 'cell') && typeof width === 'number') {
    return { alignSelf: 'flex-start', width };
  }
  return { alignSelf: 'stretch' };
}

/**
 * C-Skeleton: loading in the shape of what is coming, as flat blocks. The whole skeleton is one
 * group on the loading pulse (MO-loading), the same beat for every skeleton on screen, and one
 * busy progress bar to a screen reader, which skips the blocks.
 */
export function Skeleton({
  shape,
  width,
  height = size.listRowMin,
  lines = 1,
}: SkeletonProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const pulse = usePulse(true);
  const ground = { backgroundColor: theme.color.skeleton };

  const block = (style: ViewStyle, key?: number): JSX.Element => (
    <View key={key} style={[style, ground]} />
  );
  const bars = (widths: readonly DimensionValue[]): JSX.Element[] =>
    widths.map((barWidth, index) => block(bar(barWidth), index));

  const drawn = (): JSX.Element => {
    switch (shape) {
      case 'block':
        return block({ width: FULL, height, borderRadius: radius.none });
      case 'circle':
        return block(CIRCLE);
      case 'line':
        return <View style={LINES}>{bars(paragraph(lines))}</View>;
      case 'canvas':
      case 'cell':
        return block(CANVAS);
      case 'card':
        return (
          <View style={CARD}>
            <View style={HEADER}>
              {block(CIRCLE)}
              <View style={HEADER_LINES}>{bars(CARD_HEADER_LINES)}</View>
            </View>
            {block(CANVAS)}
            <View style={LINES}>{bars(paragraph(2))}</View>
          </View>
        );
      case 'row':
        return (
          <View style={ROW}>
            {block(CIRCLE)}
            <View style={HEADER_LINES}>{bars(paragraph(2))}</View>
          </View>
        );
      default:
        return assertNever(shape);
    }
  };

  return (
    // `accessible` makes the skeleton one element for the phone's screen reader.
    <Animated.View
      style={[frameOf(shape, width), pulse]}
      accessible={true}
      role="progressbar"
      aria-label={t('ui.loading')}
      aria-busy={true}
    >
      <View
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {drawn()}
      </View>
    </Animated.View>
  );
}
