import { assertNever } from '@citizenrun/shared';
import { useRef } from 'react';
import type { JSX, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { HostInstance, TextInstance, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/ui/components/icon-button';
import { Text } from '@/ui/components/text';
import { Wordmark } from '@/ui/components/wordmark';
import { useFocusOnMount } from '@/ui/focus';
import type { IconName } from '@/ui/icons';
import { useTheme } from '@/ui/theme';
import { size, space, z } from '@/ui/tokens';

import { useBreakpoint } from './use-breakpoint';

export type AppBarProps =
  | {
      variant: 'home';
      unreadMessages: number;
      /** Not read yet. */
      messagesHref?: string;
      /** Not read yet. */
      partTestIDs?: Partial<Record<'messages' | 'messagesBadge', string>>;
      /** Null: no Messages button and no badge. */
      onOpenMessages: (() => void) | null;
    }
  | {
      variant: 'screen';
      title: string | null;
      /** Null: no back button. */
      onBack: (() => void) | null;
      /** The back button's name, in place of the usual one. */
      backLabel?: string;
      action?: { icon: IconName; label: string; onPress: () => void; testID: string } | null;
      /** Not read yet. */
      actionRef?: RefObject<HostInstance | null>;
      /** Replaces the title. */
      center?: ReactNode;
    };

type HomeBarProps = Extract<AppBarProps, { variant: 'home' }>;
type ScreenBarProps = Extract<AppBarProps, { variant: 'screen' }>;

const HOME_BAR: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingRight: space.x1,
};
const SCREEN_BAR: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: space.x1,
  zIndex: z.sticky,
};
// Both slots are drawn even when empty, so the title stays centered.
const SLOT: ViewStyle = { width: size.target, minHeight: size.target };
const TITLE: ViewStyle = { flex: 1 };
const INSET_COVER: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  zIndex: z.sticky,
};

/** The bar of Home at compact: the wordmark at the gutter and the way to Messages. It scrolls away with the page. */
function HomeBar({ unreadMessages, onOpenMessages }: HomeBarProps): JSX.Element | null {
  const theme = useTheme();
  const layout = useBreakpoint();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');
  // At medium and expanded the mark and Messages are in the rail.
  if (layout.breakpoint !== 'compact') {
    return null;
  }
  const messages = t('ui.nav.messages');
  return (
    <View
      style={[
        HOME_BAR,
        {
          minHeight: size.appBar + insets.top,
          paddingTop: insets.top,
          paddingLeft: layout.gutter,
          backgroundColor: theme.color.bg,
        },
      ]}
    >
      <Wordmark variant="wordmark" capHeight={size.wordmarkCap.appBar} />
      {onOpenMessages === null ? null : (
        <IconButton
          icon="messages"
          badge={unreadMessages}
          label={
            unreadMessages > 0
              ? t('ui.nav.itemUnread', { item: messages, count: unreadMessages })
              : messages
          }
          testID="shell.app-bar-messages"
          onPress={onOpenMessages}
        />
      )}
    </View>
  );
}

/** The bar of every other screen: back, the title as the screen's heading, one action. It stays at the top. */
function ScreenBar({ title, onBack, backLabel, action, center }: ScreenBarProps): JSX.Element {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');
  const titleRef = useRef<TextInstance>(null);
  // A screen reader announces the screen by its heading.
  useFocusOnMount(titleRef);
  return (
    <View
      style={[
        SCREEN_BAR,
        {
          minHeight: size.appBar + insets.top,
          paddingTop: insets.top,
          backgroundColor: theme.color.bg,
        },
      ]}
    >
      <View style={SLOT}>
        {onBack === null ? null : (
          <IconButton
            icon="back"
            label={backLabel ?? t('ui.nav.back')}
            testID="shell.app-bar-back"
            onPress={onBack}
          />
        )}
      </View>
      <View style={TITLE}>
        {center ??
          (title === null ? null : (
            <Text ref={titleRef} role="bodyStrong" heading={1} numberOfLines={1} align="center">
              {title}
            </Text>
          ))}
      </View>
      <View style={SLOT}>
        {action === undefined || action === null ? null : (
          <IconButton
            icon={action.icon}
            label={action.label}
            testID={action.testID}
            onPress={action.onPress}
          />
        )}
      </View>
    </View>
  );
}

/**
 * C-AppBar: the bar at the top of a screen, and the one place that reads the top inset, which it
 * fills with its own ground. It has no rule under it.
 */
export function AppBar(props: AppBarProps): JSX.Element | null {
  switch (props.variant) {
    case 'home':
      return <HomeBar {...props} />;
    case 'screen':
      return <ScreenBar {...props} />;
    default:
      return assertNever(props);
  }
}

/**
 * The ground under the status bar, for a screen whose bar scrolls away: content never shows there.
 * It draws nothing where there is no inset.
 */
export function AppBarInsetCover(): JSX.Element | null {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  if (insets.top <= 0) {
    return null;
  }
  return (
    <View
      style={[INSET_COVER, { height: insets.top, backgroundColor: theme.color.bg }]}
      pointerEvents="none"
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
