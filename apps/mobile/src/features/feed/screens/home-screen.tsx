import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { HomeViewModel } from '@/features/feed/view-models/home.types';
import { useHomeViewModel } from '@/features/feed/view-models/use-home-view-model';
import { head } from '@/platform/head';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import type { ScreenProps } from '@/ui/components/screen';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';

const HOME_NAMESPACES = ['feed', 'common'] as const;

// The bar of Home with no way to Messages: the wordmark alone, and only at compact.
const HOME_BAR: NonNullable<ScreenProps['appBar']> = {
  variant: 'home',
  unreadMessages: 0,
  onOpenMessages: null,
};

/**
 * The placeholder: the empty chair, one sentence and one line, flush left under the home bar. It
 * asks for nothing and offers no step, because there is none to take yet.
 */
function Placeholder(): JSX.Element {
  const { t } = useTranslation(HOME_NAMESPACES);
  const layout = useBreakpoint();
  return (
    <Screen width="feed" appBar={HOME_BAR} testID="feed.home">
      {/* The feed column runs edge to edge on a phone, for its cards; words keep the gutter. */}
      <View style={layout.breakpoint === 'compact' ? { paddingHorizontal: layout.gutter } : null}>
        <EmptyState
          kind="empty"
          art="chair"
          headingLevel={1}
          title={t('feed:placeholder.title')}
          body={t('feed:placeholder.body')}
          testID="feed.placeholder"
        />
      </View>
    </Screen>
  );
}

// One drawing for each thing Home can hold: a kind the view-model gains must be given its own here.
const DRAWN: Readonly<Record<HomeViewModel['kind'], () => JSX.Element>> = {
  placeholder: Placeholder,
};

/** SCR-home. Until its offices and its feed exist, the one thing it holds is its placeholder. */
export function HomeScreenView({ vm }: { vm: HomeViewModel }): JSX.Element {
  const Drawn = DRAWN[vm.kind];
  return <Drawn />;
}

export function HomeScreen(): JSX.Element {
  const { t } = useTranslation(HOME_NAMESPACES);
  const vm = useHomeViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('feed:documentTitle') })}</head.Title>
      <HomeScreenView vm={vm} />
    </>
  );
}
