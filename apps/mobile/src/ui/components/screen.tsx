import { assertNever } from '@citizenrun/shared';
import { useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import type { HostInstance, ScrollViewInstance, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/ui/motion';
import { AppBar, AppBarInset, AppBarInsetCover } from '@/ui/shells/app-bar';
import type { AppBarProps } from '@/ui/shells/app-bar';
import { useMainLandmark, useShell } from '@/ui/shells/app-shell';
import { useReportBottomChrome } from '@/ui/shells/bottom-chrome';
import { useOnReselect } from '@/ui/shells/reselect';
import { RightColumn } from '@/ui/shells/right-column';
import { SideInsetsProvider, useBreakpoint } from '@/ui/shells/use-breakpoint';
import type { Layout } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { gutter, size, space } from '@/ui/tokens';

import { Notice } from './notice';

export type ScreenProps = {
  /** Null where the screen has no app bar. */
  appBar?: AppBarProps | null;
  /** Default 'column'. */
  width?: 'feed' | 'column' | 'profile' | 'page' | 'split' | 'longForm' | 'full';
  /** Default true; false when the child is a C-List or a map. */
  scroll?: boolean;
  /** The right column at expanded, beside a 'feed' or a 'page'. */
  aside?: ReactNode;
  /** A sticky footer, a composer or a sticky action row. */
  footer?: ReactNode;
  /** True shows the offline line under the app bar. */
  offline?: boolean;
  onRetry?: () => void;
  testID: string;
  children: ReactNode;
};

type Width = NonNullable<ScreenProps['width']>;

/** Where the parts of a screen sit in the content slot. */
type Frame = {
  /** Holds the main column and, beside it, the right column. */
  row: ViewStyle;
  /** The main column: the scroll area, or the view that stands in for it. */
  column: ViewStyle;
  /** The children's box inside the main column. */
  box: ViewStyle;
  /** The offline line's box inside the main column. */
  line: ViewStyle;
};

const FILL: ViewStyle = { flex: 1 };
const GROW: ViewStyle = { flexGrow: 1 };
const ROW: ViewStyle = { flex: 1, flexDirection: 'row' };
const OFFLINE: ViewStyle = { paddingVertical: space.x3 };

/** A box at most `max` wide between its gutters, in the middle of the slot. */
function centered(max: number, sides: ViewStyle): ViewStyle {
  return { width: '100%', maxWidth: max, alignSelf: 'center', ...sides };
}

function frameFor(
  width: Width,
  layout: Layout,
  insets: { left: number; right: number },
  besideAside: boolean,
): Frame {
  const left = layout.gutter + insets.left;
  const sides: ViewStyle = { paddingLeft: left, paddingRight: layout.gutter + insets.right };
  const single = (box: ViewStyle, line: ViewStyle = box): Frame => ({
    row: FILL,
    column: FILL,
    box,
    line,
  });
  switch (width) {
    case 'column':
      return single(centered(size.feedColumn, sides));
    case 'longForm':
      return single(centered(size.longForm, sides));
    case 'profile':
      return single(centered(size.profileColumn, sides));
    case 'full':
      return single(sides);
    case 'split':
      // The screen draws its own panes and the rule between them.
      return single({ flexDirection: 'row' }, sides);
    case 'feed': {
      if (layout.breakpoint === 'compact') {
        // Edge to edge, where the edges are the safe ones: a side inset is never drawn under.
        const safe: ViewStyle =
          insets.left > 0 || insets.right > 0
            ? { paddingLeft: insets.left, paddingRight: insets.right }
            : {};
        return single(safe, sides);
      }
      const inside: ViewStyle = { paddingHorizontal: gutter.feedColumnWide };
      if (besideAside) {
        return {
          row: { ...ROW, paddingLeft: size.columnGap },
          column: { flexGrow: 0, flexShrink: 1, width: layout.feedColumnWidth },
          box: inside,
          line: inside,
        };
      }
      return single({
        width: layout.feedColumnWidth,
        maxWidth: '100%',
        alignSelf: 'center',
        ...inside,
      });
    }
    case 'page': {
      if (besideAside) {
        const start: ViewStyle = { paddingLeft: left };
        return {
          row: ROW,
          column: { flex: 1, maxWidth: size.officeContent + left },
          box: start,
          line: start,
        };
      }
      return single({
        width: '100%',
        maxWidth: size.officeContent + left + layout.gutter + insets.right,
        alignSelf: 'flex-start',
        ...sides,
      });
    }
    default:
      return assertNever(width);
  }
}

/**
 * C-Screen: the frame of one screen inside the shell's content slot. From the top: the app bar, or
 * the top inset alone where the screen has no bar, the shell's banner, the offline line, the
 * children at the width asked for, and a footer that the keyboard pushes up. At expanded the right
 * column stands beside the main column and scrolls by itself. Its content is the page's `main`
 * where no shell above marks one. It gives the side insets it reads to the layout of everything
 * under it.
 */
export function Screen({
  appBar,
  width = 'column',
  scroll = true,
  aside,
  footer,
  offline = false,
  onRetry,
  testID,
  children,
}: ScreenProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const insets = useSafeAreaInsets();
  const shell = useShell();
  const { t } = useTranslation('common');
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const contentRef = useRef<HostInstance>(null);
  // MO-tab-restore: the tab this screen belongs to is the one that was active when it first drew.
  const [tab] = useState(shell.active);
  const [footerHeight, setFooterHeight] = useState(0);

  useOnReselect(scroll ? tab : null, () => {
    scrollRef.current?.scrollTo({ x: 0, y: 0, animated: !reducedMotion });
  });
  useReportBottomChrome(footer === undefined || footer === null ? 0 : footerHeight);
  // The landmark comes and goes with the shell's mode, and the content stays mounted through it.
  useMainLandmark(contentRef, !shell.mainProvided);

  // Only the two widths that leave room for a right column draw one, and only at expanded.
  const showsAside =
    aside !== undefined &&
    aside !== null &&
    layout.showsRightColumn &&
    (width === 'feed' || width === 'page');
  const frame = frameFor(width, layout, insets, showsAside);

  // A screen with no bar keeps the top inset clear in the bar's place.
  const bar = appBar === undefined || appBar === null ? <AppBarInset /> : <AppBar {...appBar} />;
  // The bar of Home scrolls away with the page; every other bar stays.
  const barScrolls = appBar?.variant === 'home' && scroll;

  const offlineLine = offline ? (
    <View style={[frame.line, OFFLINE]}>
      <Notice
        kind="info"
        text={t('ui.offline')}
        {...(onRetry === undefined
          ? {}
          : {
              action: {
                label: t('ui.retry'),
                onPress: onRetry,
                testID: `${testID}-offline-retry`,
              },
            })}
      />
    </View>
  ) : null;

  return (
    <View style={[FILL, { backgroundColor: theme.color.bg }]} testID={testID}>
      {barScrolls ? null : bar}
      <SideInsetsProvider left={insets.left} right={insets.right}>
        <KeyboardAvoidingView behavior="padding" style={FILL}>
          <View ref={contentRef} style={FILL}>
            <View style={frame.row}>
              {scroll ? (
                <ScrollView
                  ref={scrollRef}
                  style={frame.column}
                  contentContainerStyle={GROW}
                  keyboardShouldPersistTaps="handled"
                  testID={`${testID}-scroll`}
                >
                  {barScrolls ? bar : null}
                  {shell.banner}
                  {offlineLine}
                  <View style={[frame.box, GROW]}>{children}</View>
                </ScrollView>
              ) : (
                <View style={frame.column}>
                  {shell.banner}
                  {offlineLine}
                  <View style={[frame.box, FILL]}>{children}</View>
                </View>
              )}
              {showsAside ? <RightColumn>{aside}</RightColumn> : null}
            </View>
            {footer === undefined || footer === null ? null : (
              <View
                onLayout={(event) => {
                  setFooterHeight(event.nativeEvent.layout.height);
                }}
              >
                {footer}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </SideInsetsProvider>
      {barScrolls ? <AppBarInsetCover /> : null}
    </View>
  );
}
