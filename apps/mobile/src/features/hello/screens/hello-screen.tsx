import { assertNever } from '@citizenrun/shared';
import { useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import type { HelloData, HelloViewModel } from '@/features/hello/view-models/hello.types';
import { useHelloViewModel } from '@/features/hello/view-models/use-hello-view-model';
import { head } from '@/platform/head';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { Rule } from '@/ui/components/rule';
import { Screen } from '@/ui/components/screen';
import type { ScreenProps } from '@/ui/components/screen';
import { Skeleton } from '@/ui/components/skeleton';
import { Text } from '@/ui/components/text';
import { useFocusOnMount } from '@/ui/focus';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

type HelloReady = Extract<HelloViewModel, { status: 'ready' }>;

// The bar of Home with no way to Messages: the wordmark alone, and only at compact.
const HOME_BAR: NonNullable<ScreenProps['appBar']> = {
  variant: 'home',
  unreadMessages: 0,
  onOpenMessages: null,
};

const CONTENT: ViewStyle = { paddingBottom: space.x8 };
const INTRO: ViewStyle = { marginTop: space.x2 };
const STATUS: ViewStyle = { marginTop: space.x8 };
const STATUS_HEADING: ViewStyle = { marginTop: space.x3, marginBottom: space.x2 };
// A value that does not fit beside its label moves under it, and each wraps inside the row.
const ROW: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  alignContent: 'center',
  justifyContent: 'space-between',
  columnGap: space.x4,
  rowGap: space.x1,
  minHeight: size.listRowMin,
  paddingVertical: space.x3,
};
const CELL: ViewStyle = { flexShrink: 1, maxWidth: '100%' };
const ACTION: ViewStyle = { marginTop: space.x6 };
const SKELETON_ROW: ViewStyle = { minHeight: size.listRowMin, justifyContent: 'center' };

/** One check: what was asked, and what answered. */
function StatusRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string;
  testID: string;
}): JSX.Element {
  return (
    <View style={ROW}>
      <View style={CELL}>
        <Text role="body">{label}</Text>
      </View>
      <View style={CELL}>
        <Text role="bodyStrong" testID={testID}>
          {value}
        </Text>
      </View>
    </View>
  );
}

/** The three checks and the way to ask again. A worker that has gone quiet is said in its own row. */
function Ready({ vm }: { vm: HelloReady }): JSX.Element {
  const { t } = useTranslation(['hello']);
  const layout = useBreakpoint();
  const titleRef = useRef<TextInstance>(null);
  // A screen reader announces the screen by its heading.
  useFocusOnMount(titleRef);

  const workerValue = (worker: HelloData['worker']): string => {
    switch (worker) {
      case 'running':
        return t('hello:status.workerOk');
      case 'stale':
        return t('hello:status.workerStale');
      default:
        return assertNever(worker);
    }
  };

  return (
    <>
      <Text
        ref={titleRef}
        role={layout.isTight ? 'title' : 'display'}
        heading={1}
        testID="hello.title"
      >
        {t('hello:title')}
      </Text>
      <View style={INTRO}>
        <Text role="body" tone="secondary">
          {t('hello:intro')}
        </Text>
      </View>
      <View style={STATUS}>
        <Rule variant="strong" />
        <View style={STATUS_HEADING}>
          <Text role="monoLabel" heading={2}>
            {t('hello:status.heading')}
          </Text>
        </View>
        <StatusRow
          label={t('hello:status.server')}
          value={t('hello:status.serverOk')}
          testID="hello.status-server"
        />
        <Rule variant="soft" />
        <StatusRow
          label={t('hello:status.database')}
          value={t('hello:status.databaseOk')}
          testID="hello.status-database"
        />
        <Rule variant="soft" />
        <StatusRow
          label={t('hello:status.worker')}
          value={workerValue(vm.data.worker)}
          testID="hello.status-worker"
        />
      </View>
      <View style={ACTION}>
        <Button
          variant="secondary"
          label={t('hello:refresh')}
          onPress={vm.data.onRefresh}
          busy={vm.refreshing}
          testID="hello.refresh"
        />
      </View>
    </>
  );
}

/**
 * The ready screen as flat blocks. The first block is the one progress bar a screen reader meets;
 * the others pulse with it and stay out of its way, so "Loading" is said once.
 */
function Loading(): JSX.Element {
  const titleHeight = typography.display.style.lineHeight;
  return (
    <>
      <Skeleton shape="block" {...(titleHeight === undefined ? {} : { height: titleHeight })} />
      <View
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        <View style={INTRO}>
          <Skeleton shape="line" />
        </View>
        <View style={STATUS}>
          <View style={SKELETON_ROW}>
            <Skeleton shape="line" />
          </View>
          <View style={SKELETON_ROW}>
            <Skeleton shape="line" />
          </View>
          <View style={SKELETON_ROW}>
            <Skeleton shape="line" />
          </View>
        </View>
        <View style={ACTION}>
          <Skeleton shape="block" height={size.button} width={size.button * 3} />
        </View>
      </View>
    </>
  );
}

/** The room above and under the screen's own content. An empty state brings its own. */
function Column({ children }: { children: ReactNode }): JSX.Element {
  const layout = useBreakpoint();
  return (
    <View style={[CONTENT, { paddingTop: layout.breakpoint === 'compact' ? space.x6 : space.x8 }]}>
      {children}
    </View>
  );
}

function Content({ vm }: { vm: HelloViewModel }): JSX.Element {
  const { t } = useTranslation(['common', 'errors']);
  switch (vm.status) {
    case 'loading':
      return (
        <Column>
          <Loading />
        </Column>
      );
    case 'error':
      return (
        <EmptyState
          kind="error"
          art="chair"
          headingLevel={1}
          title={t(`errors:${vm.code}`)}
          action={{
            label: t('common:ui.retry'),
            onPress: vm.onRetry,
            variant: 'primary',
            testID: 'hello.retry',
          }}
        />
      );
    case 'offline':
      return (
        <EmptyState
          art="chair"
          headingLevel={1}
          title={t('common:states.offlineTitle')}
          body={t('common:states.offlineBody')}
          action={{
            label: t('common:ui.retry'),
            onPress: vm.onRetry,
            variant: 'primary',
            testID: 'hello.retry',
          }}
        />
      );
    case 'ready':
      return (
        <Column>
          <Ready vm={vm} />
        </Column>
      );
    default:
      return assertNever(vm);
  }
}

/** SCR-hello: whether the app reaches its server, the database behind it and the background jobs. */
export function HelloScreenView({ vm }: { vm: HelloViewModel }): JSX.Element {
  return (
    <Screen
      width="column"
      testID="hello.screen"
      appBar={HOME_BAR}
      offline={vm.status === 'ready' && vm.stale}
      {...(vm.status === 'ready' ? { onRetry: vm.data.onRefresh } : {})}
    >
      <Content vm={vm} />
    </Screen>
  );
}

export function HelloScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'hello']);
  const vm = useHelloViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('hello:documentTitle') })}</head.Title>
      <HelloScreenView vm={vm} />
    </>
  );
}
