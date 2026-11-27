import { assertNever } from '@citizenrun/shared';
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { motion, useStamp } from '@/ui/motion';
import type { AnimatedStyle } from '@/ui/motion';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTight } from '@/ui/shells/use-tight';
import { useTheme } from '@/ui/theme';
import { gutter, rule, size, space, z } from '@/ui/tokens';

import { Button } from './button';
import { Icon } from './icon';
import { IconButton } from './icon-button';
import { Text } from './text';

export type RunSlot =
  | { state: 'idle' }
  | { state: 'running' }
  /** The label says why: "Filing closed", "No election scheduled". */
  | { state: 'unavailable'; label: string }
  /** Before Run exists. */
  | { state: 'hidden' };

type Part = 'run' | 'follow' | 'bookmark' | 'like' | 'comment' | 'repost' | 'share' | 'repostCount';

export type ActionRowProps = {
  kind: 'office';
  /** 'row' (default): under a card, in a sheet. 'sticky': the office page's bar. 'stacked': the desktop action card. */
  layout?: 'row' | 'sticky' | 'stacked';
  run: RunSlot;
  following: boolean;
  bookmarked: boolean;
  onRun: () => void;
  onToggleFollow: () => void;
  onToggleBookmark: () => void;
  /** The item the row acts on: a done state stamps once for each press on it. */
  itemKey: string;
  /** The ids a screen names for the row's parts; a part without one is `<testID>-<part>` (D-522). */
  partTestIDs?: Partial<Record<Part, string>>;
  testID: string;
};

type RowLayout = NonNullable<ActionRowProps['layout']>;

/**
 * The style that stamps a control's content when `done` turns on (MO-follow): from the done scale
 * onto the stamp spring, once for each change from false to true. A control that mounts done plays
 * nothing, and turning off cuts back. Under reduced motion the new content fades in.
 */
export function useDoneStamp(done: boolean): AnimatedStyle {
  const [seen, setSeen] = useState(done);
  const [playKey, setPlayKey] = useState<number | null>(null);
  // Counted while rendering, so the stamp starts in the frame the done state is first drawn in.
  if (seen !== done) {
    setSeen(done);
    if (done) setPlayKey((playKey ?? 0) + 1);
  }
  return useStamp(playKey, { scale: motion.scale.done });
}

export type WidthLockProps = {
  /** What the button draws in its other state: its label, and the check of a done state. */
  twin: { label: string; done: boolean };
  /** The size of the button it holds; default 'md'. */
  size?: 'md' | 'sm';
  /** The button, at the full width of the lock. */
  children: ReactNode;
};

// The twin takes no height and is never seen: only its width counts.
const TWIN: ViewStyle = { height: 0, overflow: 'hidden' };
// The room a button keeps at each side of its label, with its outline.
const TWIN_BOX: ViewStyle = {
  flexDirection: 'row',
  alignSelf: 'flex-start',
  gap: space.x2,
  paddingHorizontal: space.x4 + rule.hairline,
};
const TWIN_BOX_SMALL: ViewStyle = { ...TWIN_BOX, paddingHorizontal: space.x3 + rule.hairline };

/**
 * Keeps a two-state button as wide as the wider of its two states, from the first frame: under the
 * button stands a copy of what its other state draws, with no height, so the box takes the larger
 * width of the two. A done state then never moves a neighbour.
 */
export function WidthLock({ twin, size: sizeName = 'md', children }: WidthLockProps): JSX.Element {
  const small = sizeName === 'sm';
  return (
    <View>
      {children}
      <View
        style={TWIN}
        pointerEvents="none"
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        <View style={small ? TWIN_BOX_SMALL : TWIN_BOX}>
          {twin.done ? <Icon name="check" size="medium" /> : null}
          <Text role={small ? 'label' : 'bodyStrong'} numberOfLines={1}>
            {twin.label}
          </Text>
        </View>
      </View>
    </View>
  );
}

type RunControlProps = {
  run: Exclude<RunSlot, { state: 'hidden' }>;
  layout: RowLayout;
  onRun: () => void;
  testID: string;
};

/**
 * The name of a Run button whose words are not in the long form ("Running", or why it cannot be
 * taken): the words it shows, then the long form, so what a person sees is in what is read out.
 */
function namedWith(shown: string, name: string): string {
  return `${shown}. ${name}`;
}

/** Run: the accent button, its ink done state, or a disabled button that says why. Never an icon. */
function RunControl({ run, layout, onRun, testID }: RunControlProps): JSX.Element {
  const { t } = useTranslation('common');
  // The same answer the button gives itself, so the bar and its button change together.
  const isTight = useTight();
  // The name holds the long form whatever the button shows.
  const name = t('ui.actions.runLong');
  const short = t('ui.actions.run');

  if (run.state === 'unavailable') {
    return (
      <Button
        variant="run"
        label={run.label}
        accessibilityLabel={namedWith(run.label, name)}
        disabled={true}
        fullWidth={true}
        testID={testID}
      />
    );
  }

  const running = run.state === 'running';
  const idleLabel = layout === 'row' ? short : name;
  const runningLabel = t('ui.actions.running');
  const button = running ? (
    <Button
      variant="primary"
      label={runningLabel}
      done={true}
      accessibilityLabel={namedWith(runningLabel, name)}
      selected={true}
      fullWidth={true}
      onPress={onRun}
      testID={testID}
    />
  ) : (
    <Button
      variant="run"
      label={idleLabel}
      {...(layout === 'sticky' ? { shortLabel: short } : {})}
      accessibilityLabel={name}
      fullWidth={true}
      onPress={onRun}
      testID={testID}
    />
  );
  // Under a card the two slots are equal whatever they hold.
  if (layout === 'row') {
    return button;
  }
  const twin = running
    ? { label: layout === 'sticky' && isTight ? short : idleLabel, done: false }
    : { label: runningLabel, done: true };
  return <WidthLock twin={twin}>{button}</WidthLock>;
}

type ToggleProps = { on: boolean; onToggle: () => void; testID: string };

/** Follow: an outline button, and the ink button with the check once following. */
function FollowControl({ on, onToggle, testID }: ToggleProps): JSX.Element {
  const { t } = useTranslation('common');
  const stamp = useDoneStamp(on);
  const follow = t('ui.actions.follow');
  const following = t('ui.actions.following');
  // The haptic marks the commitment, never its undoing (MO-follow).
  const turning = on
    ? { accessibilityHint: t('ui.actions.unfollowHint') }
    : { haptic: 'medium' as const };
  return (
    <WidthLock twin={on ? { label: follow, done: false } : { label: following, done: true }}>
      <Animated.View style={stamp}>
        <Button
          variant={on ? 'primary' : 'secondary'}
          label={on ? following : follow}
          done={on}
          selected={on}
          fullWidth={true}
          onPress={onToggle}
          testID={testID}
          {...turning}
        />
      </Animated.View>
    </WidthLock>
  );
}

/** Bookmark: a plain icon button whose icon fills once bookmarked. Never framed. */
function BookmarkControl({ on, onToggle, testID }: ToggleProps): JSX.Element {
  const { t } = useTranslation('common');
  const stamp = useDoneStamp(on);
  return (
    <Animated.View style={stamp}>
      <IconButton
        icon="bookmark"
        selectedIcon="bookmarkFilled"
        selected={on}
        label={on ? t('ui.actions.bookmarked') : t('ui.actions.bookmark')}
        onPress={onToggle}
        testID={testID}
        {...(on ? {} : { haptic: 'light' as const })}
      />
    </Animated.View>
  );
}

const SLOT: ViewStyle = { flex: 1, minWidth: 0 };
// Follow across the two equal slots, with the gap between them inside it.
const SLOT_DOUBLE: ViewStyle = { flex: 2, minWidth: 0 };
// As wide as its button's wider state, and never squeezed.
const SLOT_NATURAL: ViewStyle = { flexShrink: 0 };
const SLOT_FIXED: ViewStyle = { width: size.target };

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x2,
  minHeight: size.actionRow,
  paddingVertical: space.x2,
};
const STICKY: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x2,
  borderTopWidth: rule.hairline,
  paddingTop: space.x3,
  zIndex: z.sticky,
};
const STACKED: ViewStyle = { gap: space.x2 };
const STACKED_ROW: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };

type FrameProps = { testID: string; children: ReactNode };

/** The row under a card: the screen's gutter at compact, the feed column's own from medium up. */
function RowFrame({ testID, children }: FrameProps): JSX.Element {
  const layout = useBreakpoint();
  return (
    <View
      testID={testID}
      style={[
        ROW,
        {
          paddingHorizontal:
            layout.breakpoint === 'compact' ? layout.gutter : gutter.feedColumnWide,
        },
      ]}
    >
      {children}
    </View>
  );
}

/** The office page's bar: the page's ground under a hairline, clear of the bottom inset. */
function StickyFrame({ testID, children }: FrameProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  // The one layout that reads an inset: the bar fills the bottom one with its own ground.
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      style={[
        STICKY,
        {
          backgroundColor: theme.color.bg,
          borderTopColor: theme.color.rule,
          paddingBottom: space.x3 + insets.bottom,
          paddingHorizontal: layout.gutter,
        },
      ]}
    >
      {children}
    </View>
  );
}

/** The three office actions in the layout asked for. It draws its props and holds no state of theirs. */
function OfficeActions({
  layout = 'row',
  run,
  following,
  bookmarked,
  onRun,
  onToggleFollow,
  onToggleBookmark,
  partTestIDs,
  testID,
}: ActionRowProps): JSX.Element {
  const idOf = (part: 'run' | 'follow' | 'bookmark'): string =>
    partTestIDs?.[part] ?? `${testID}-${part}`;

  const runControl =
    run.state === 'hidden' ? null : (
      <RunControl run={run} layout={layout} onRun={onRun} testID={idOf('run')} />
    );
  const follow = <FollowControl on={following} onToggle={onToggleFollow} testID={idOf('follow')} />;
  const bookmark = (
    <View style={SLOT_FIXED}>
      <BookmarkControl on={bookmarked} onToggle={onToggleBookmark} testID={idOf('bookmark')} />
    </View>
  );

  switch (layout) {
    case 'row':
      return (
        <RowFrame testID={testID}>
          {runControl === null ? null : <View style={SLOT}>{runControl}</View>}
          <View style={runControl === null ? SLOT_DOUBLE : SLOT}>{follow}</View>
          {bookmark}
        </RowFrame>
      );
    case 'sticky':
      return (
        <StickyFrame testID={testID}>
          {runControl === null ? null : <View style={SLOT}>{runControl}</View>}
          {/* Run takes the free width; without it Follow does. */}
          <View style={runControl === null ? SLOT : SLOT_NATURAL}>{follow}</View>
          {bookmark}
        </StickyFrame>
      );
    case 'stacked':
      return (
        <View testID={testID} style={STACKED}>
          {runControl}
          <View style={STACKED_ROW}>
            <View style={SLOT}>{follow}</View>
            {bookmark}
          </View>
        </View>
      );
    default:
      return assertNever(layout);
  }
}

/**
 * C-ActionRow: the fixed action row of an office. Run, Follow and Bookmark stand in the same three
 * places under a card, in the office page's bar and in the desktop action card. A done state swaps
 * ink and paper inside a slot that keeps its size, so no neighbour ever moves; turning on stamps
 * once, and turning off cuts back. With Run hidden, Follow takes its place as well.
 */
export function ActionRow(props: ActionRowProps): JSX.Element {
  // A row handed another item starts again, so a done state it arrives with never stamps.
  return <OfficeActions key={props.itemKey} {...props} />;
}
