import type { JSX, ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { radius, size, space } from '@/ui/tokens';

import { IconButton } from './icon-button';
import { Link } from './link';
import { Pressable } from './pressable';
import { Skeleton } from './skeleton';
import { Text } from './text';

export type CardShellProps = {
  header: {
    /** A C-Avatar of size sm for a post; a C-OfficeTile of size md for a generated card. */
    leading: ReactElement;
    /** A post: the author's name. A card: the reason it is shown. Never the office's name. */
    title: string;
    titleHref?: string;
    /** A post: the handle, then the context. A card: the issue match. */
    subtitle: ReactNode;
    onOpenMenu: (() => void) | null;
  };
  box: { kind: 'canvas'; canvas: ReactElement; altText: string };
  /** Where a tap on the box goes. */
  href?: string;
  /** A C-ActionRow. */
  actions: ReactElement | null;
  /** The rows of the meta block, in order. */
  meta: ReactNode;
  loading?: boolean;
  testID: string;
};

/** The box is 4:5: its width over its height. */
const BOX_RATIO = 4 / 5;

const HEADER: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  minHeight: size.cardHeaderMin,
  paddingVertical: space.x2,
};
const WORDS: ViewStyle = { flex: 1, minWidth: 0, marginLeft: space.x3 };
const MENU: ViewStyle = { marginLeft: space.x2 };
const META: ViewStyle = { rowGap: space.x2, paddingBottom: space.x6 };

/**
 * C-CardShell: the one frame of every feed item. A header row that says why the item is shown, a
 * 4:5 box, the action row, then the meta rows, read in that order. The canvas in the box is a
 * still: a screen reader hears the box's alt text in its place, and a tap on the box opens its
 * page with no press scale. Nothing is drawn over the box and no rule runs round it.
 */
export function CardShell({
  header,
  box,
  href,
  actions,
  meta,
  loading = false,
  testID,
}: CardShellProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const { t } = useTranslation('common');
  // Full bleed at compact; inside the feed column everything is as wide as the canvas.
  const width = layout.canvasWidth;
  const sides = layout.breakpoint === 'compact' ? layout.gutter : 0;

  if (loading) {
    return (
      <View style={{ width, paddingHorizontal: sides }} testID={`${testID}-loading`}>
        <Skeleton shape="card" />
      </View>
    );
  }

  const title = (
    <Text role="label" numberOfLines={1}>
      {header.title}
    </Text>
  );
  const ground: ViewStyle = {
    width,
    aspectRatio: BOX_RATIO,
    backgroundColor: theme.color.surface,
    borderRadius: radius.none,
  };
  // The canvas reaches no screen reader: the box says its alt text.
  const canvas = (
    <View
      style={ground}
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {box.canvas}
    </View>
  );

  return (
    <View style={{ width }} role="group" testID={testID}>
      <View style={[HEADER, { paddingHorizontal: sides }]}>
        {header.leading}
        <View style={WORDS}>
          {header.titleHref === undefined ? (
            title
          ) : (
            <Link variant="bare" href={header.titleHref} testID={`${testID}-title`}>
              {title}
            </Link>
          )}
          {header.subtitle}
        </View>
        {header.onOpenMenu === null ? null : (
          <View style={MENU}>
            <IconButton
              icon="more"
              label={t('ui.more')}
              onPress={header.onOpenMenu}
              testID={`${testID}-menu`}
            />
          </View>
        )}
      </View>
      {href === undefined ? (
        // `accessible` makes the box one element for the phone's screen reader.
        <View accessible={true} role="img" aria-label={box.altText} testID={`${testID}-box`}>
          {canvas}
        </View>
      ) : (
        // A card's box navigates without a press scale (MO-press).
        <Pressable
          role="link"
          href={href}
          label={box.altText}
          feedback="none"
          hover="none"
          radius={radius.none}
          testID={`${testID}-box`}
        >
          {canvas}
        </Pressable>
      )}
      {actions}
      <View style={[META, { paddingHorizontal: sides }]}>{meta}</View>
    </View>
  );
}
