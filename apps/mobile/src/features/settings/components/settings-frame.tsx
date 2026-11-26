import { assertNever } from '@citizenrun/shared';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ViewState } from '@/lib/view-state';
import { Button } from '@/ui/components/button';
import type { ButtonProps } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { Notice } from '@/ui/components/notice';
import { Screen } from '@/ui/components/screen';
import { SectionHeader } from '@/ui/components/section-header';
import { Skeleton } from '@/ui/components/skeleton';
import { StickyFooter } from '@/ui/components/sticky-footer';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { rule, size, space, z } from '@/ui/tokens';

import { errorText } from './error-text';
import { SETTINGS_NAMESPACES } from './settings-translation';
import { useSettingsBack } from './use-settings-back';

export type SettingsFrameProps<T> = {
  /** The screen's view-model; a plain one is passed as a ready state. */
  state: ViewState<T>;
  /** The app bar's title, which is the screen's heading; null where the content brings its own. */
  title: string | null;
  /** Where the back control leads when there is nothing to go back to. */
  parentHref: string;
  /** Default 'column'. */
  width?: 'column' | 'longForm';
  /** The label drawn above the loading rows; null where the screen starts with no group. */
  firstGroup: string | null;
  testID: string;
  footer?: (data: T, stale: boolean) => ReactNode;
  children: (data: T, stale: boolean) => ReactNode;
};

/** How many rows stand in for a list that is still loading. */
const LOADING_ROWS = 3;

const CONTENT: ViewStyle = { paddingTop: space.x4, paddingBottom: space.x8 };
const GROUP_AFTER: ViewStyle = { marginTop: space.x6 };

/** Out of a screen reader's way: every loading row after the first, which says nothing new. */
const QUIET = {
  'aria-hidden': true,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * The frame every settings screen shares: one column under an app bar with a back control, and
 * the loading, error and offline states drawn the same way on each. While the content is shown
 * from the cache without a connection, the offline line stands under the app bar.
 */
export function SettingsFrame<T>({
  state,
  title,
  parentHref,
  width = 'column',
  firstGroup,
  testID,
  footer,
  children,
}: SettingsFrameProps<T>): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  const onBack = useSettingsBack(parentHref);
  // Under an app bar with no title, a full-screen state's sentence is the screen's heading.
  const headingLevel = title === null ? 1 : 2;

  const bodyOf = (): ReactNode => {
    switch (state.status) {
      case 'loading':
        return (
          <>
            {firstGroup === null ? null : <SectionHeader label={firstGroup} level={2} />}
            {Array.from({ length: LOADING_ROWS }, (_row, row) => (
              <View key={row} {...(row === 0 ? {} : QUIET)}>
                <Skeleton shape="row" />
              </View>
            ))}
          </>
        );
      case 'error':
        return (
          <EmptyState
            kind="error"
            art="chair"
            headingLevel={headingLevel}
            title={t('common:states.errorTitle')}
            body={errorText(state.code, t)}
            action={{
              label: t('common:ui.retry'),
              onPress: state.onRetry,
              testID: `${testID}-retry`,
            }}
          />
        );
      case 'offline':
        return (
          <EmptyState
            art="chair"
            headingLevel={headingLevel}
            title={t('common:states.offlineTitle')}
            body={t('common:states.offlineBody')}
            action={{
              label: t('common:ui.retry'),
              onPress: state.onRetry,
              testID: `${testID}-retry`,
            }}
          />
        );
      case 'ready':
        return children(state.data, state.stale);
      default:
        return assertNever(state);
    }
  };

  return (
    <Screen
      width={width}
      appBar={{ variant: 'screen', title, onBack }}
      offline={state.status === 'ready' && state.stale}
      footer={
        state.status === 'ready' && footer !== undefined ? footer(state.data, state.stale) : null
      }
      testID={testID}
    >
      <View style={CONTENT}>{bodyOf()}</View>
    </Screen>
  );
}

export type SettingsGroupProps = {
  label: string;
  /** The first group of a screen stands right under the app bar. */
  first?: boolean;
  children: ReactNode;
};

/** A group of a settings screen: a rule, its label, then its rows. */
export function SettingsGroup({ label, first = false, children }: SettingsGroupProps): JSX.Element {
  return (
    <View style={first ? null : GROUP_AFTER}>
      <SectionHeader label={label} level={2} />
      {children}
    </View>
  );
}

export type SettingsFooterProps = {
  /** What was refused, said above the bar; null while nothing was. */
  error: string | null;
  /** Default 'primary'. 'destructive' draws the button that opens a confirming dialog. */
  variant?: 'primary' | 'destructive';
  button: Pick<ButtonProps, 'label' | 'onPress' | 'disabled' | 'busy' | 'testID'>;
};

// As wide as the screen's column, and in the middle of a wider window with it.
const FOOT_COLUMN: ViewStyle = { width: '100%', maxWidth: size.feedColumn, alignSelf: 'center' };
const FOOT_NOTICE: ViewStyle = { paddingBottom: space.x3 };
// The bar of C-StickyFooter, around a button that C-StickyFooter does not draw.
const BAR: ViewStyle = { zIndex: z.sticky, borderTopWidth: rule.hairline, paddingTop: space.x3 };

/** The foot of a settings screen that saves by a button: what was refused, then the bar. */
export function SettingsFooter({
  error,
  variant = 'primary',
  button,
}: SettingsFooterProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const insets = useSafeAreaInsets();
  return (
    <View style={FOOT_COLUMN}>
      {error === null ? null : (
        <View style={[FOOT_NOTICE, { paddingHorizontal: layout.gutter }]}>
          <Notice kind="error" text={error} />
        </View>
      )}
      {variant === 'primary' ? (
        <StickyFooter primary={button} />
      ) : (
        <View
          style={[
            BAR,
            {
              backgroundColor: theme.color.bg,
              borderTopColor: theme.color.rule,
              paddingBottom: space.x3 + insets.bottom,
              paddingLeft: layout.gutter + insets.left,
              paddingRight: layout.gutter + insets.right,
            },
          ]}
        >
          <Button {...button} variant="destructive" fullWidth={true} />
        </View>
      )}
    </View>
  );
}
