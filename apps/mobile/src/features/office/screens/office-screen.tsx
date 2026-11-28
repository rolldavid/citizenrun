import type { CardContext } from '@citizenrun/cards';
import { assertNever } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { useCallback, useMemo, useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { LayoutChangeEvent, ScrollViewInstance, ViewStyle } from 'react-native';

import { OfficeActionCard } from '@/features/office/components/office-action-card';
import { OfficeBoard } from '@/features/office/components/office-board';
import { OfficeBudget } from '@/features/office/components/office-budget';
import { OfficeControls } from '@/features/office/components/office-controls';
import { OfficeDeal } from '@/features/office/components/office-deal';
import { OfficeFiling } from '@/features/office/components/office-filing';
import { OfficeHero } from '@/features/office/components/office-hero';
import { OfficeHolders } from '@/features/office/components/office-holders';
import { OfficeLoading } from '@/features/office/components/office-loading';
import { OfficeNotices } from '@/features/office/components/office-notices';
import { OfficePay } from '@/features/office/components/office-pay';
import { OfficeRunning } from '@/features/office/components/office-running';
import { OfficeSheets } from '@/features/office/components/office-sheets';
import { OfficeSources } from '@/features/office/components/office-sources';
import { OFFICE_TEST_IDS } from '@/features/office/components/office-test-ids';
import { OfficeWhere } from '@/features/office/components/office-where';
import { errorSentence, presentActions } from '@/features/office/components/present-office';
import type { OfficeBlockId } from '@/features/office/components/present-office';
import type { OfficeViewModel } from '@/features/office/view-models/office.types';
import { useOfficeViewModel } from '@/features/office/view-models/use-office-view-model';
import { goBack } from '@/lib/navigation';
import { useNow } from '@/lib/now';
import { head } from '@/platform/head';
import { ActionRow } from '@/ui/components/action-row';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

export type OfficeScreenProps = { slug: string };

type ReadyOffice = Extract<OfficeViewModel, { status: 'ready' }>;

const OFFICE_NAMESPACES = ['office', 'common', 'errors'] as const;

const FILL: ViewStyle = { flex: 1 };
const CONTENT: ViewStyle = { paddingBottom: space.x12 };
const STATE: ViewStyle = { paddingTop: space.x4, paddingBottom: space.x8 };
// The room above a block: the deal stands close under the hero, a section stands apart.
const UNDER_HERO: ViewStyle = { paddingTop: space.x6 };
const SECTION: ViewStyle = { paddingTop: space.x8 };

/** Back from the office page: where the person came from, or Home on a direct load. */
function leave(): void {
  goBack('/');
}

/** The page's translate function as the presenters take it. */
function usePageT(): { t: TFunction; locale: string } {
  const { t, i18n } = useTranslation(OFFICE_NAMESPACES);
  // The typed t accepts catalog keys only; the presenters pass each key as a plain string.
  return { t: t as unknown as TFunction, locale: i18n.language };
}

/** A full-screen state of the page, under the app bar with no title: its sentence is the heading. */
function StateFrame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Screen
      width="page"
      appBar={{ variant: 'screen', title: null, onBack: leave }}
      testID={OFFICE_TEST_IDS.screen}
    >
      <View style={STATE}>{children}</View>
    </Screen>
  );
}

type BlockProps = {
  id: OfficeBlockId;
  style?: ViewStyle;
  /** Tells the page where the block starts in its scroll area. */
  onPlace: (id: OfficeBlockId, y: number) => void;
  children: ReactNode;
};

/** One block of the page, which reports where it starts so the page can move to it. */
function Block({ id, style, onPlace, children }: BlockProps): JSX.Element {
  return (
    <View
      style={style}
      onLayout={(event: LayoutChangeEvent) => {
        onPlace(id, event.nativeEvent.layout.y);
      }}
    >
      {children}
    </View>
  );
}

/**
 * The page itself: one scroll area holding the blocks in their order, with the two actions in a
 * bar under it, or in a card beside it when the window is wide.
 */
function OfficePage({ vm }: { vm: ReadyOffice }): JSX.Element {
  const { t, locale } = usePageT();
  const layout = useBreakpoint();
  const now = useNow();
  const ctx = useMemo<CardContext>(() => ({ locale, now }), [locale, now]);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const tops = useRef(new Map<OfficeBlockId, number>());

  const scrollToBlock = useCallback((id: OfficeBlockId): void => {
    const y = tops.current.get(id);
    if (y !== undefined) {
      // A cut: the page never glides to a section.
      scrollRef.current?.scrollTo({ x: 0, y, animated: false });
    }
  }, []);
  const place = useCallback((id: OfficeBlockId, y: number): void => {
    tops.current.set(id, y);
  }, []);

  const { data, stale } = vm;
  const { office } = data;
  const block = { data, t, ctx };
  const compact = layout.breakpoint === 'compact';
  // On a phone the scroll area leaves the frame's gutters, so the hero reaches both edges, and its
  // content takes them back. Beside the rail it runs to the right edge of the window, so the page
  // scrolls from anywhere in it.
  const spare = compact
    ? 0
    : Math.max(0, layout.mainWidth - (size.officeContent + layout.gutter * 2));
  const area: ViewStyle = compact
    ? { marginHorizontal: -layout.gutter }
    : layout.showsRightColumn
      ? {}
      : { marginRight: -spare };
  const inside: ViewStyle = compact
    ? { paddingHorizontal: layout.gutter }
    : layout.showsRightColumn
      ? {}
      : { paddingRight: spare };
  const bleed: ViewStyle = compact ? { marginHorizontal: -layout.gutter } : {};

  return (
    <Screen
      width="page"
      scroll={false}
      offline={stale}
      appBar={{ variant: 'screen', title: office.title, onBack: leave }}
      {...(layout.showsRightColumn
        ? { aside: <OfficeActionCard data={data} t={t} ctx={ctx} /> }
        : {
            footer: <ActionRow {...presentActions(office, data.actions, t)} layout="sticky" />,
          })}
      testID={OFFICE_TEST_IDS.screen}
    >
      <OfficeSheets vm={vm} t={t} ctx={ctx} onScrollToBlock={scrollToBlock}>
        <ScrollView
          ref={scrollRef}
          style={[FILL, area]}
          contentContainerStyle={[CONTENT, inside]}
          keyboardShouldPersistTaps="handled"
        >
          <Block id="hero" style={bleed} onPlace={place}>
            <OfficeHero office={office} t={t} ctx={ctx} />
          </Block>
          <Block id="notices" onPlace={place}>
            <OfficeNotices data={data} t={t} />
          </Block>
          <Block id="deal" style={UNDER_HERO} onPlace={place}>
            <OfficeDeal {...block} />
          </Block>
          <Block id="where" style={SECTION} onPlace={place}>
            <OfficeWhere data={data} t={t} />
          </Block>
          <Block id="pay" style={SECTION} onPlace={place}>
            <OfficePay {...block} />
          </Block>
          <Block id="controls" style={SECTION} onPlace={place}>
            <OfficeControls {...block} />
          </Block>
          <Block id="budget" style={SECTION} onPlace={place}>
            <OfficeBudget {...block} />
          </Block>
          <Block id="holders" style={SECTION} onPlace={place}>
            <OfficeHolders {...block} />
          </Block>
          {office.boardControl === null ? null : (
            <Block id="board" style={SECTION} onPlace={place}>
              <OfficeBoard data={data} t={t} />
            </Block>
          )}
          <Block id="filing" style={SECTION} onPlace={place}>
            <OfficeFiling {...block} />
          </Block>
          <Block id="sources" style={SECTION} onPlace={place}>
            <OfficeSources {...block} stale={stale} />
          </Block>
          <Block id="running" style={SECTION} onPlace={place}>
            <OfficeRunning {...block} />
          </Block>
        </ScrollView>
      </OfficeSheets>
    </Screen>
  );
}

/** SCR-office-slug: the office page in every state of its view-model. */
export function OfficeScreenView({ vm }: { vm: OfficeViewModel }): JSX.Element {
  const { t } = usePageT();
  switch (vm.status) {
    case 'loading':
      return <OfficeLoading />;
    case 'error':
      if (vm.code === 'not_found') {
        return (
          <StateFrame>
            <EmptyState
              kind="empty"
              art="chair"
              headingLevel={1}
              title={t('office:notFound.title')}
              action={{
                label: t('office:notFound.home'),
                href: '/',
                variant: 'secondary',
                testID: OFFICE_TEST_IDS.notFoundAction,
              }}
            />
          </StateFrame>
        );
      }
      return (
        <StateFrame>
          <EmptyState
            kind="error"
            art="chair"
            headingLevel={1}
            title={t('common:states.errorTitle')}
            body={errorSentence(vm.code, t)}
            action={{
              label: t('common:ui.retry'),
              onPress: vm.onRetry,
              testID: `${OFFICE_TEST_IDS.screen}-retry`,
            }}
          />
        </StateFrame>
      );
    case 'offline':
      return (
        <StateFrame>
          <EmptyState
            art="chair"
            headingLevel={1}
            title={t('common:states.offlineTitle')}
            body={t('common:states.offlineBody')}
            action={{
              label: t('common:ui.retry'),
              onPress: vm.onRetry,
              testID: `${OFFICE_TEST_IDS.screen}-retry`,
            }}
          />
        </StateFrame>
      );
    case 'ready':
      return <OfficePage vm={vm} />;
    default:
      return assertNever(vm);
  }
}

export function OfficeScreen({ slug }: OfficeScreenProps): JSX.Element {
  const { t } = usePageT();
  const vm = useOfficeViewModel(slug);
  const title = vm.status === 'ready' ? vm.data.office.title : t('office:documentTitle');
  return (
    <>
      <head.Title>{t('common:documentTitle', { title })}</head.Title>
      <OfficeScreenView vm={vm} />
    </>
  );
}
