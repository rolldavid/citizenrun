import { assertNever } from '@citizenrun/shared';
import type { JSX } from 'react';

import { SCREEN_FIXTURES } from '@/features/dev/screen-fixtures';
import type { ScreenRegistryEntry, ScreenShell } from '@/features/dev/screen-fixtures';
import { HelloScreenView, helloFixtures } from '@/features/hello';
import {
  NotFoundScreenView,
  RootLayoutScreenView,
  SystemUpdateScreenView,
  systemUpdateFixtures,
} from '@/features/system';
import type { RootViewModel } from '@/features/system';
import { ToastOutlet } from '@/ui/components/toast';
import { AppShell } from '@/ui/shells/app-shell';
import { ThemeProvider, useTheme } from '@/ui/theme';
import { textScale } from '@/ui/tokens';

export type FixtureViewProps = {
  screen: string;
  fixture: string;
  /** Default SCREEN_FIXTURES. */
  registry?: Readonly<Record<string, ScreenRegistryEntry>>;
};

export type FixtureScreenProps = FixtureViewProps & {
  /** The `textScale` query value as the route read it; anything but a number from 1 to 1.3 is 1. */
  textScale?: string | undefined;
};

const BARE: ScreenShell = { mode: 'bare' };
const NO_UNREAD = { messages: 0, activity: 0 };

/** The shell around a fixture leads nowhere. */
function stay(): void {
  // nothing to do
}

/**
 * One screen drawn from one named fixture, inside the shell its entry names; a pair the registry
 * does not hold draws the not-found content. It reads no route.
 */
export function FixtureView({
  screen,
  fixture,
  registry = SCREEN_FIXTURES,
}: FixtureViewProps): JSX.Element {
  const entry = Object.hasOwn(registry, screen) ? registry[screen] : undefined;
  const drawn = entry?.render(fixture) ?? null;
  if (entry === undefined || drawn === null) {
    return <NotFoundScreenView />;
  }
  const shell = entry.shell ?? BARE;
  switch (shell.mode) {
    case 'app':
      return (
        <AppShell
          mode="app"
          active={shell.active}
          onNavigate={stay}
          onReselect={stay}
          unread={NO_UNREAD}
          place={null}
          topBar={null}
          banner={null}
          signedIn={false}
        >
          {drawn}
        </AppShell>
      );
    case 'bare':
    case 'own':
      return drawn;
    default:
      return assertNever(shell);
  }
}

/** SCR-root-layout around a ready screen, with the update screen for the fixture that shows one. */
export function RootLayoutFixtureView({ vm }: { vm: RootViewModel }): JSX.Element {
  return (
    <RootLayoutScreenView
      vm={vm}
      systemScreen={<SystemUpdateScreenView vm={systemUpdateFixtures.updateNoStore} />}
    >
      <HelloScreenView vm={helloFixtures.helloReady} />
    </RootLayoutScreenView>
  );
}

/** The text scale a dev route asks for (PC6A-09). */
function scaleOf(raw: string | undefined): number {
  const asked = Number(raw);
  return Number.isFinite(asked) && asked >= 1 && asked <= textScale.maxLargeRoles ? asked : 1;
}

/** SCR-dev-screens: one fixture, at the text scale the route's query asks for. */
export function FixtureScreen({
  screen,
  fixture,
  registry = SCREEN_FIXTURES,
  textScale: rawTextScale,
}: FixtureScreenProps): JSX.Element {
  const theme = useTheme();
  const scale = scaleOf(rawTextScale);
  const view = <FixtureView screen={screen} fixture={fixture} registry={registry} />;
  if (scale === 1) {
    return view;
  }
  return (
    <ThemeProvider choice={theme.name} textScale={scale}>
      {view}
      {/* A toast the screen raises is drawn here, at the text size the screen is drawn at. */}
      <ToastOutlet place="screen" />
    </ThemeProvider>
  );
}
