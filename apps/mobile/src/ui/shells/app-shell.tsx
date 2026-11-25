import { createContext, useContext, useLayoutEffect, useMemo, useRef } from 'react';
import type { JSX, ReactElement, ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { HostInstance, ViewStyle } from 'react-native';

import { Pressable } from '@/ui/components/pressable';
import { Text } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, z } from '@/ui/tokens';

import { Rail } from './rail';
import { emitReselect } from './reselect';
import { useReportSideChrome } from './side-chrome';
import { TopBarHeightProvider, useBreakpoint } from './use-breakpoint';
import type { Breakpoint } from './use-breakpoint';

export type NavItemId = 'home' | 'explore' | 'post' | 'activity' | 'messages' | 'profile';

export type AppShellProps = {
  /** 'app': full chrome. 'bare': no navigation chrome (welcome, sign-in, onboarding, system screens). */
  mode: 'app' | 'bare';
  active: NavItemId | null;
  /** The root layout maps items to routes. */
  onNavigate: (item: NavItemId) => void;
  /** The active item was chosen again; passed to C-TabBar and C-Rail. */
  onReselect: (item: NavItemId) => void;
  unread: { messages: number; activity: number };
  /** Expanded rail foot. Null hides it. */
  place: { name: string; districtCount: number; officeCount: number } | null;
  /** Web only: the announcement bar element, or null. */
  topBar: ReactNode | null;
  /** The standing banner of a suspended account, or null. */
  banner: ReactElement | null;
  /** False: nav items other than Home open sign-in. */
  signedIn: boolean;
  /** The navigator. */
  children: ReactNode;
};

export type ShellContextValue = {
  banner: ReactElement | null;
  /** True when the shell above marked its content slot as the page's `main`. */
  mainProvided: boolean;
  active: NavItemId | null;
};

export type ShellLayoutProps = AppShellProps & { breakpoint: Breakpoint };

const NO_SHELL: ShellContextValue = { banner: null, mainProvided: false, active: null };

const ShellContext = createContext<ShellContextValue>(NO_SHELL);

/** What the shell above tells its screens; outside any shell there is no banner, no `main` and no active item. */
export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}

const ROOT: ViewStyle = { flex: 1 };
const TOP_BAR: ViewStyle = { height: size.getAppBar, zIndex: z.bar };
const ROW: ViewStyle = { flex: 1, flexDirection: 'row' };
const ROW_EXPANDED: ViewStyle = {
  ...ROW,
  width: '100%',
  maxWidth: size.contentMax,
  alignSelf: 'center',
};
// The slot takes focus from the skip link, and shows no ring of its own for it. A style of its own
// replaces the browser's ring, which a width alone does not.
const CONTENT: ViewStyle = { flex: 1, outlineStyle: 'solid', outlineWidth: 0 };

/** A view whose attributes can be set from code: the web's element is one, a phone's view is not. */
type AttributeHost = {
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

function hasAttributes(host: unknown): host is AttributeHost {
  return (
    typeof host === 'object' &&
    host !== null &&
    'setAttribute' in host &&
    typeof host.setAttribute === 'function' &&
    'removeAttribute' in host &&
    typeof host.removeAttribute === 'function'
  );
}

/**
 * Makes `ref`'s view the page's `main` while `marked` is true, and no landmark otherwise: the
 * content slot of C-AppShell, and the content of a C-Screen that no shell marks. A role given as a
 * prop picks the element the web draws, and a different element mounts everything under it again;
 * the attribute alone changes the landmark and leaves the view, and what it holds, where they are.
 */
export function useMainLandmark(ref: RefObject<HostInstance | null>, marked: boolean): void {
  useLayoutEffect(() => {
    const host: unknown = ref.current;
    if (!hasAttributes(host)) {
      return;
    }
    if (marked) {
      host.setAttribute('role', 'main');
    } else {
      host.removeAttribute('role');
    }
  }, [ref, marked]);
}

const SKIP_ANCHOR: ViewStyle = {
  position: 'absolute',
  top: space.x2,
  left: space.x2,
  zIndex: z.popover,
};
const SKIP_BOX: ViewStyle = {
  paddingVertical: space.x2,
  paddingHorizontal: space.x3,
  borderWidth: rule.hairline,
  borderRadius: radius.control,
};
// Out of the flow and clear: the link takes no room and no press until the keyboard reaches it.
const SKIP_BOX_HIDDEN: ViewStyle = { position: 'absolute', opacity: 0 };

/**
 * The skip link: the first thing the keyboard reaches. It shows only while it has focus, and a
 * press moves focus to the content slot.
 */
function SkipLink({ target }: { target: RefObject<HostInstance | null> }): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const label = t('ui.nav.skipToContent');
  return (
    <View style={SKIP_ANCHOR} pointerEvents="box-none">
      <Pressable
        role="link"
        label={label}
        testID="shell.skip-link"
        feedback="none"
        onPress={() => {
          target.current?.focus();
        }}
      >
        {({ focused }) => (
          <View
            style={[
              SKIP_BOX,
              { backgroundColor: theme.color.bg, borderColor: theme.color.rule },
              focused ? null : SKIP_BOX_HIDDEN,
            ]}
            pointerEvents={focused ? 'auto' : 'none'}
          >
            <Text role="label">{label}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

/**
 * The shell at one breakpoint. Every breakpoint and mode draws the same elements in the same
 * places, with nothing where a part is absent, so a change of breakpoint or of mode never remounts
 * the children.
 */
export function ShellLayout({
  mode,
  active,
  onNavigate,
  onReselect,
  unread,
  place,
  topBar,
  banner,
  breakpoint,
  children,
}: ShellLayoutProps): JSX.Element {
  const theme = useTheme();
  const mainRef = useRef<HostInstance>(null);
  const inApp = mode === 'app';
  useMainLandmark(mainRef, inApp);
  const shell = useMemo<ShellContextValue>(
    () => ({ banner, mainProvided: inApp, active }),
    [banner, inApp, active],
  );

  return (
    <View style={[ROOT, { backgroundColor: theme.color.bg }]}>
      {inApp ? <SkipLink target={mainRef} /> : null}
      {topBar !== null ? <View style={TOP_BAR}>{topBar}</View> : null}
      <TopBarHeightProvider height={topBar !== null ? size.getAppBar : 0}>
        <View style={breakpoint === 'expanded' ? ROW_EXPANDED : ROW}>
          {inApp && breakpoint !== 'compact' ? (
            <Rail
              variant={breakpoint === 'medium' ? 'icons' : 'labeled'}
              active={active}
              unread={unread}
              place={place}
              onNavigate={onNavigate}
              onReselect={(item) => {
                // The signal first, so the screens of the item scroll before the route changes.
                emitReselect(item);
                onReselect(item);
              }}
            />
          ) : null}
          <ShellContext.Provider value={shell}>
            <View ref={mainRef} tabIndex={-1} style={CONTENT}>
              {children}
            </View>
          </ShellContext.Provider>
        </View>
      </TopBarHeightProvider>
    </View>
  );
}

/** The width of the rail a shell draws: none at compact, and none without navigation chrome. */
function railWidthOf(mode: AppShellProps['mode'], breakpoint: Breakpoint): number {
  if (mode !== 'app' || breakpoint === 'compact') {
    return 0;
  }
  return breakpoint === 'medium' ? size.railIcon : size.rail;
}

/**
 * C-AppShell: the one component the root layout renders around the navigator. It draws the chrome
 * of the window's breakpoint around the same mounted screens, and reads no route, query or session.
 */
export function AppShell(props: AppShellProps): JSX.Element {
  const { breakpoint } = useBreakpoint();
  // What is centered in the content slot, the toast, stands clear of the rail this shell draws.
  useReportSideChrome(railWidthOf(props.mode, breakpoint));
  return <ShellLayout {...props} breakpoint={breakpoint} />;
}
