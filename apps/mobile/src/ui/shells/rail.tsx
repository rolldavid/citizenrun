import { assertNever } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { CountBadge } from '@/ui/components/count-badge';
import { Icon } from '@/ui/components/icon';
import { Pressable } from '@/ui/components/pressable';
import { Text } from '@/ui/components/text';
import { Tooltip } from '@/ui/components/tooltip';
import { Wordmark } from '@/ui/components/wordmark';
import { playHaptic } from '@/ui/haptic';
import type { IconName } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, z } from '@/ui/tokens';

import type { AppShellProps, NavItemId } from './app-shell';

export type RailProps = {
  /** 'icons': the narrow rail of icons alone. 'labeled': the wide rail, each icon with its label. */
  variant: 'icons' | 'labeled';
  active: NavItemId | null;
  onNavigate: (item: NavItemId) => void;
  /** The active item was chosen again. */
  onReselect: (item: NavItemId) => void;
  unread: { messages: number; activity: number };
  /** The foot of the labeled rail. Null hides it. */
  place: AppShellProps['place'];
};

/** The destinations, in the order the rail lists them under the mark. */
const RAIL_ITEMS: readonly NavItemId[] = [
  'home',
  'explore',
  'post',
  'activity',
  'messages',
  'profile',
];

// Above the content beside it, so a tooltip that is wider than the rail is not drawn under it.
const RAIL: ViewStyle = {
  paddingTop: space.x6,
  paddingBottom: space.x6,
  borderRightWidth: rule.hairline,
  zIndex: z.sticky,
};
const RAIL_ICONS: ViewStyle = { ...RAIL, width: size.railIcon };
const RAIL_LABELED: ViewStyle = { ...RAIL, width: size.rail, paddingHorizontal: space.x3 };

const MARK_ICONS: ViewStyle = { alignItems: 'center', marginBottom: space.x8 };
// The mark starts where the icons under it start.
const MARK_LABELED: ViewStyle = { paddingHorizontal: space.x3, marginBottom: space.x8 };

const ITEMS: ViewStyle = { gap: space.x1 };

// The bar of the active item, at the rail's left edge. It stands outside the press target, so it
// stays still while the item moves.
const BAR: ViewStyle = {
  position: 'absolute',
  top: space.x2,
  bottom: space.x2,
  width: rule.active,
};
const BAR_ICONS: ViewStyle = { ...BAR, left: 0 };
// The labeled rail keeps its rows clear of its edge: the bar reaches back to it.
const BAR_LABELED: ViewStyle = { ...BAR, left: -space.x3 };

// As wide as the rail inside its rule. The width is its own: the tooltip round a cell is as large
// as the cell, and does not stretch it.
const SLOT_ICONS: ViewStyle = { width: size.railIcon - rule.hairline, alignItems: 'center' };
// The box keeps the press target, and with it the fill and the focus ring, to the square.
const SQUARE_BOX: ViewStyle = { width: size.target };
const SQUARE: ViewStyle = {
  width: size.target,
  height: size.target,
  alignItems: 'center',
  justifyContent: 'center',
};
const CORNER: ViewStyle = { position: 'absolute', top: -space.x1, right: -space.x2 };

const ROW: ViewStyle = {
  minHeight: size.railItem,
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  paddingHorizontal: space.x3,
};
const ROW_LABEL: ViewStyle = { flex: 1 };

const SPACER: ViewStyle = { flex: 1 };
const FOOT: ViewStyle = { paddingHorizontal: space.x3, paddingTop: space.x6 };
const FOOT_COUNTS: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.x1 };

/** A middle dot between the two counts of the foot: it holds no letter, so it is not a string of the catalog. */
const DOT = '·';

function iconOf(item: NavItemId, active: boolean): IconName {
  switch (item) {
    case 'home':
      return active ? 'homeFilled' : 'home';
    case 'explore':
      return active ? 'exploreFilled' : 'explore';
    case 'post':
      return 'plus';
    case 'activity':
      return active ? 'activityFilled' : 'activity';
    case 'messages':
      return active ? 'messagesFilled' : 'messages';
    case 'profile':
      return active ? 'profileFilled' : 'profile';
    default:
      return assertNever(item);
  }
}

type RailItemProps = {
  item: NavItemId;
  variant: RailProps['variant'];
  isActive: boolean;
  /** The word the labeled rail shows, and the tooltip of a cell of the icons rail. */
  label: string;
  /** The accessible name: the label, with the unread count when there is one. */
  name: string;
  /** The unread count; 0 draws no badge. */
  count: number;
  onPress: () => void;
};

/** One destination: a row in the labeled rail, a square in the icons rail. */
function RailItem({
  item,
  variant,
  isActive,
  label,
  name,
  count,
  onPress,
}: RailItemProps): JSX.Element {
  const theme = useTheme();
  // Post opens the create dialog and goes nowhere itself.
  const role = item === 'post' ? 'button' : 'link';
  const testID = `shell.rail-${item}`;
  const icon = <Icon name={iconOf(item, isActive)} tone="primary" />;

  if (variant === 'labeled') {
    return (
      <View>
        {isActive ? (
          <View style={[BAR_LABELED, { backgroundColor: theme.color.text }]} pointerEvents="none" />
        ) : null}
        <Pressable
          role={role}
          current={isActive}
          label={name}
          testID={testID}
          feedback="moveAndFill"
          hover="fill"
          onPress={onPress}
        >
          <View style={ROW}>
            {icon}
            <View style={ROW_LABEL}>
              <Text role={isActive ? 'bodyStrong' : 'body'}>{label}</Text>
            </View>
            <CountBadge count={count} size="row" />
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    // The icons rail shows no word, so a tooltip names each cell.
    <Tooltip text={label}>
      <View style={SLOT_ICONS}>
        {isActive ? (
          <View style={[BAR_ICONS, { backgroundColor: theme.color.text }]} pointerEvents="none" />
        ) : null}
        <View style={SQUARE_BOX}>
          <Pressable
            role={role}
            current={isActive}
            label={name}
            testID={testID}
            feedback="move"
            hover="fill"
            onPress={onPress}
          >
            {({ swapsFill }) => (
              <View
                style={[
                  SQUARE,
                  // Under reduced motion the press shows as a fill (PC6A-21).
                  swapsFill
                    ? { backgroundColor: theme.color.pressedBg, borderRadius: radius.control }
                    : null,
                ]}
              >
                <View>
                  {icon}
                  {count > 0 ? (
                    <View style={CORNER} pointerEvents="none">
                      <CountBadge count={count} size="corner" />
                    </View>
                  ) : null}
                </View>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </Tooltip>
  );
}

/**
 * C-Rail: the left navigation of the medium and expanded shells. The mark, then the six
 * destinations; the active one carries a bar at the rail's edge and the filled icon, never an ink
 * block. It is as tall as the row it sits in and never scrolls with the page.
 */
export function Rail({
  variant,
  active,
  onNavigate,
  onReselect,
  unread,
  place,
}: RailProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const labeled = variant === 'labeled';

  const labelOf = (item: NavItemId): string => {
    switch (item) {
      case 'home':
        return t('ui.nav.home');
      case 'explore':
        return t('ui.nav.explore');
      case 'post':
        return t('ui.nav.post');
      case 'activity':
        return t('ui.nav.activity');
      case 'messages':
        return t('ui.nav.messages');
      case 'profile':
        return t('ui.nav.profile');
      default:
        return assertNever(item);
    }
  };

  const countOf = (item: NavItemId): number => {
    if (item === 'messages') return unread.messages;
    if (item === 'activity') return unread.activity;
    return 0;
  };

  const choose = (item: NavItemId): void => {
    // C-AppShell's handler sends the reselect signal, so the rail sends none itself.
    if (item === active) {
      onReselect(item);
      return;
    }
    playHaptic('selection');
    onNavigate(item);
  };

  return (
    <View
      role="navigation"
      aria-label={t('ui.nav.main')}
      testID="shell.rail"
      style={[
        labeled ? RAIL_LABELED : RAIL_ICONS,
        { backgroundColor: theme.color.bg, borderRightColor: theme.color.rule },
      ]}
    >
      <View style={labeled ? MARK_LABELED : MARK_ICONS}>
        {labeled ? (
          <Wordmark variant="wordmark" capHeight={size.wordmarkCap.rail} />
        ) : (
          <Wordmark variant="monogram" capHeight={size.monogramRail} />
        )}
      </View>
      <View style={ITEMS}>
        {RAIL_ITEMS.map((item) => {
          const label = labelOf(item);
          const count = countOf(item);
          return (
            <RailItem
              key={item}
              item={item}
              variant={variant}
              isActive={item === active}
              label={label}
              name={count > 0 ? t('ui.nav.itemUnread', { item: label, count }) : label}
              count={count}
              onPress={() => {
                choose(item);
              }}
            />
          );
        })}
      </View>
      {labeled && place !== null ? (
        <>
          <View style={SPACER} />
          <View style={FOOT}>
            <Text role="monoLabel" tone="secondary">
              {place.name}
            </Text>
            <View style={FOOT_COUNTS}>
              <Text role="caption" tone="secondary">
                {t('ui.nav.districts', { count: place.districtCount })}
              </Text>
              <Text role="caption" tone="secondary" hidden>
                {DOT}
              </Text>
              <Text role="caption" tone="secondary">
                {t('ui.nav.offices', { count: place.officeCount })}
              </Text>
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}
