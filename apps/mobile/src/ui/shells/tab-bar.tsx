import { assertNever } from '@citizenrun/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CountBadge } from '@/ui/components/count-badge';
import { Icon } from '@/ui/components/icon';
import { Pressable } from '@/ui/components/pressable';
import { Text } from '@/ui/components/text';
import { playHaptic } from '@/ui/haptic';
import type { IconName } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, z } from '@/ui/tokens';

import type { NavItemId } from './app-shell';
import { useReportBottomChrome } from './bottom-chrome';
import { emitReselect } from './reselect';

export type TabBarProps = {
  active: NavItemId;
  onNavigate: (item: NavItemId) => void;
  /** The active tab was chosen again. */
  onReselect: (item: NavItemId) => void;
  unreadActivity: number;
};

/** The five tabs, in the order the bar draws them. Messages is not among them. */
const TAB_ITEMS = ['home', 'explore', 'post', 'activity', 'profile'] as const;

type TabItem = (typeof TAB_ITEMS)[number];

const BAR: ViewStyle = {
  flexDirection: 'row',
  paddingTop: space.x1,
  paddingHorizontal: space.x2,
  borderTopWidth: rule.hairline,
  zIndex: z.sticky,
};
const CELL: ViewStyle = { flex: 1 };
// What the bar leaves a cell under its rule and the space above the icons.
const CELL_CONTENT: ViewStyle = {
  minHeight: size.tabBar - space.x1 - rule.hairline,
  alignItems: 'center',
  justifyContent: 'center',
};
const POST_BLOCK: ViewStyle = {
  width: size.postTabBlock.width,
  height: size.postTabBlock.height,
  borderRadius: radius.control,
  alignItems: 'center',
  justifyContent: 'center',
};
const CORNER: ViewStyle = { position: 'absolute', top: -space.x1, right: -space.x2 };

function iconOf(item: Exclude<TabItem, 'post'>, active: boolean): IconName {
  switch (item) {
    case 'home':
      return active ? 'homeFilled' : 'home';
    case 'explore':
      return active ? 'exploreFilled' : 'explore';
    case 'activity':
      return active ? 'activityFilled' : 'activity';
    case 'profile':
      return active ? 'profileFilled' : 'profile';
    default:
      return assertNever(item);
  }
}

/**
 * C-TabBar: the bottom navigation of the compact shell. Five links, the active one filled and in
 * ink, Post as an ink block with no label. Changing tabs is a cut. It leaves while the software
 * keyboard is open, and reports the height it covers at the bottom edge.
 */
export function TabBar({
  active,
  onNavigate,
  onReselect,
  unreadActivity,
}: TabBarProps): JSX.Element | null {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardOpen(true);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardOpen(false);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  useReportBottomChrome(keyboardOpen ? 0 : height);

  if (keyboardOpen) {
    return null;
  }

  const labelOf = (item: TabItem): string => {
    switch (item) {
      case 'home':
        return t('ui.nav.home');
      case 'explore':
        return t('ui.nav.explore');
      case 'post':
        return t('ui.nav.post');
      case 'activity':
        return t('ui.nav.activity');
      case 'profile':
        return t('ui.nav.profile');
      default:
        return assertNever(item);
    }
  };

  const choose = (item: TabItem): void => {
    if (item === active) {
      // The bar stands outside the shell's handler, so it sends the signal itself.
      emitReselect(item);
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
      style={[
        BAR,
        {
          minHeight: size.tabBar + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: theme.color.bg,
          borderTopColor: theme.color.rule,
        },
      ]}
      onLayout={(event) => {
        setHeight(event.nativeEvent.layout.height);
      }}
    >
      {TAB_ITEMS.map((item) => {
        const isActive = item === active;
        const label = labelOf(item);
        const unread = item === 'activity' ? unreadActivity : 0;
        return (
          <View key={item} style={CELL}>
            <Pressable
              role="link"
              current={isActive}
              label={unread > 0 ? t('ui.nav.itemUnread', { item: label, count: unread }) : label}
              testID={`shell.tab-${item}`}
              feedback="move"
              hover="fill"
              onPress={() => {
                choose(item);
              }}
            >
              {({ swapsFill }) => (
                <View
                  style={[
                    CELL_CONTENT,
                    // Under reduced motion the press shows as a fill (PC6A-21).
                    swapsFill
                      ? { backgroundColor: theme.color.pressedBg, borderRadius: radius.control }
                      : null,
                  ]}
                >
                  {item === 'post' ? (
                    <View style={[POST_BLOCK, { backgroundColor: theme.color.inverseBg }]}>
                      <Icon name="plus" tone="inverse" />
                    </View>
                  ) : (
                    <>
                      <View>
                        <Icon
                          name={iconOf(item, isActive)}
                          tone={isActive ? 'primary' : 'secondary'}
                        />
                        {unread > 0 ? (
                          <View style={CORNER} pointerEvents="none">
                            <CountBadge count={unread} size="corner" />
                          </View>
                        ) : null}
                      </View>
                      <Text
                        role={isActive ? 'captionStrong' : 'caption'}
                        tone={isActive ? 'primary' : 'secondary'}
                        align="center"
                      >
                        {label}
                      </Text>
                    </>
                  )}
                </View>
              )}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
