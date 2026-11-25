import { assertNever, typeRoles } from '@citizenrun/shared';
import type { ErrorCode, TypeRole } from '@citizenrun/shared';
import { useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { LayoutChangeEvent, TextInstance, ViewStyle } from 'react-native';

import type { HelloData, HelloViewModel } from '@/features/hello/view-models/hello.types';
import { useHelloViewModel } from '@/features/hello/view-models/use-hello-view-model';
import { head } from '@/platform/head';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { Rule } from '@/ui/components/rule';
import { Screen } from '@/ui/components/screen';
import type { ScreenProps } from '@/ui/components/screen';
import { SKELETON_TEXT_BAR, Skeleton } from '@/ui/components/skeleton';
import { Text } from '@/ui/components/text';
import { useFocusOnMount } from '@/ui/focus';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

type HelloReady = Extract<HelloViewModel, { status: 'ready' }>;

// The codes whose text needs a value this screen does not have. The readiness check answers with
// none of them; one that comes anyway reads the generic text, never a gap where the value goes.
type CodeWithValue = 'handle_change_too_soon';

function isPlainCode(code: ErrorCode): code is Exclude<ErrorCode, CodeWithValue> {
  return code !== 'handle_change_too_soon';
}

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
// A text that has not come stands in its place, unseen, so its box is the size the text takes.
const UNSEEN: ViewStyle = { opacity: 0, pointerEvents: 'none' };
// One line of the same text, out of the flow: the height of a line at the text size in use.
const ONE_LINE: ViewStyle = { position: 'absolute', top: 0, right: 0, left: 0 };
// The bars lie over the box and never past it.
const BARS: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  overflow: 'hidden',
};
// Bars that stand for body text or a label keep to the middle of the box.
const MIDDLE: ViewStyle = { flex: 1, justifyContent: 'center' };
// The title's bars: each a line of the title less the room between two lines.
const TITLE_BARS: ViewStyle = { paddingVertical: space.x1, gap: space.x2 };
// A title on one line stops short of its column.
const TITLE_WIDE: ViewStyle = { width: '80%' };
// The last line of a title stops short, as a last line does.
const TITLE_LAST: ViewStyle = { width: '60%' };
const LABEL_BAR = size.target * 2;
const VALUE_BAR = size.target + space.x4;
// The button with its English label.
const BUTTON_BLOCK = size.button * 3 - space.x3;

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

/** Out of a screen reader's way: the blocks after the first, which say nothing new. */
function Quiet({ children, style }: { children: ReactNode; style?: ViewStyle }): JSX.Element {
  return (
    <View
      style={style}
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}

/** One check that has not answered: a bar where its label stands and a bar where its value does. */
function SkeletonRow(): JSX.Element {
  return (
    <View style={ROW}>
      <Skeleton shape="block" width={LABEL_BAR} height={SKELETON_TEXT_BAR} />
      <Skeleton shape="block" width={VALUE_BAR} height={SKELETON_TEXT_BAR} />
    </View>
  );
}

/**
 * The box of a text that has not come. The text itself, unseen and unsaid, gives the box its size,
 * so what stands under it does not move when the text arrives, at any width and any text size.
 * `children` draws the bars for the lines the text takes and the height of one line; until the box
 * is measured those are `guess` and the role's own line.
 */
function TextBox({
  role,
  text,
  guess,
  children,
}: {
  role: TypeRole;
  text: string;
  guess: number;
  children: (lines: number, line: number) => ReactNode;
}): JSX.Element {
  const [box, setBox] = useState<number | null>(null);
  const [one, setOne] = useState<number | null>(null);
  const measured = box !== null && one !== null && one > 0;
  const lines = measured ? Math.max(1, Math.round(box / one)) : guess;
  const line = measured ? one : typeRoles[role].lineHeight;
  return (
    <View>
      <Quiet style={UNSEEN}>
        <View
          onLayout={(event: LayoutChangeEvent) => {
            setBox(event.nativeEvent.layout.height);
          }}
        >
          <Text role={role}>{text}</Text>
        </View>
        <View
          style={ONE_LINE}
          onLayout={(event: LayoutChangeEvent) => {
            setOne(event.nativeEvent.layout.height);
          }}
        >
          <Text role={role} numberOfLines={1}>
            {text}
          </Text>
        </View>
      </Quiet>
      <View style={BARS}>{children(lines, line)}</View>
    </View>
  );
}

/**
 * The ready screen as flat blocks, so nothing moves when the answer comes: the title, the intro and
 * the group's heading each in the box its text takes, on as many lines as it takes; the three
 * checks with a bar at each end; and the button. The rules are the ready screen's own.
 * The first block is the one progress bar a screen reader meets; the others pulse with it and stay
 * out of its way, so "Loading" is said once.
 */
function Loading(): JSX.Element {
  const { t } = useTranslation(['hello']);
  const layout = useBreakpoint();
  const compact = layout.breakpoint === 'compact';
  // Until a box is measured: the title and the intro break once at compact and stand on one line
  // of a wider column.
  const guess = compact ? 2 : 1;
  return (
    <>
      <TextBox role={layout.isTight ? 'title' : 'display'} text={t('hello:title')} guess={guess}>
        {(lines, line) => (
          <View style={[TITLE_BARS, lines === 1 ? TITLE_WIDE : null]}>
            <Skeleton shape="block" height={line - space.x2} />
            {Array.from({ length: lines - 1 }, (_, index) => (
              <Quiet key={index} {...(index === lines - 2 ? { style: TITLE_LAST } : {})}>
                <Skeleton shape="block" height={line - space.x2} />
              </Quiet>
            ))}
          </View>
        )}
      </TextBox>
      <Quiet>
        <View style={INTRO}>
          <TextBox role="body" text={t('hello:intro')} guess={guess}>
            {(lines) => (
              <View style={MIDDLE}>
                <Skeleton shape="line" lines={lines} />
              </View>
            )}
          </TextBox>
        </View>
        <View style={STATUS}>
          <Rule variant="strong" />
          <View style={STATUS_HEADING}>
            <TextBox role="monoLabel" text={t('hello:status.heading')} guess={1}>
              {() => (
                <View style={MIDDLE}>
                  <Skeleton shape="block" width={size.target} height={space.x3} />
                </View>
              )}
            </TextBox>
          </View>
          <SkeletonRow />
          <Rule variant="soft" />
          <SkeletonRow />
          <Rule variant="soft" />
          <SkeletonRow />
        </View>
        <View style={ACTION}>
          <Skeleton shape="block" height={size.button} width={BUTTON_BLOCK} />
        </View>
      </Quiet>
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
          title={t('common:states.errorTitle')}
          body={isPlainCode(vm.code) ? t(`errors:${vm.code}`) : t('errors:generic')}
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
