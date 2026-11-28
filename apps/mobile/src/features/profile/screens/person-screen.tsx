import { assertNever } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import {
  PERSON_TEST_IDS,
  errorSentence,
  presentPersonHeader,
  presentSeatRow,
} from '@/features/profile/components/present-person';
import type { PersonViewModel } from '@/features/profile/view-models/person.types';
import { usePersonViewModel } from '@/features/profile/view-models/use-person-view-model';
import { goBack } from '@/lib/navigation';
import { head } from '@/platform/head';
import { EmptyState } from '@/ui/components/empty-state';
import { ListRow } from '@/ui/components/list-row';
import { Notice } from '@/ui/components/notice';
import { ProfileHeader } from '@/ui/components/profile-header';
import { Screen } from '@/ui/components/screen';
import { SectionHeader } from '@/ui/components/section-header';
import { Skeleton } from '@/ui/components/skeleton';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

export type PersonScreenProps = { slug: string };

type ReadyPerson = Extract<PersonViewModel, { status: 'ready' }>;

const PERSON_NAMESPACES = ['profile', 'common', 'errors'] as const;

/** The seat rows the page shows while it loads. */
const LOADING_ROWS = 2;

const PAGE: ViewStyle = { paddingTop: space.x4, paddingBottom: space.x12 };
const STATE: ViewStyle = { paddingTop: space.x4, paddingBottom: space.x8 };
const UNDER_HEADER: ViewStyle = { paddingTop: space.x4 };
const SECTION: ViewStyle = { paddingTop: space.x8 };
const NONE: ViewStyle = { paddingVertical: space.x3 };
// The loading blocks stand where the header's photo, its lines and the seat rows will.
const LOADING_HEADER: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', gap: space.x4 };
const LOADING_LINES: ViewStyle = { flex: 1, minWidth: 0 };

/** Out of a screen reader's way: every loading block after the first, which says nothing new. */
const QUIET = {
  'aria-hidden': true,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/** Back from a person's page: where the viewer came from, or Home on a direct load. */
function leave(): void {
  goBack('/');
}

/** The page's translate function as the presenters take it. */
function usePageT(): TFunction {
  const { t } = useTranslation(PERSON_NAMESPACES);
  // The typed t accepts catalog keys only; the presenters pass each key as a plain string.
  return t as unknown as TFunction;
}

/** The page's frame under an app bar with no title: a loading page, or a full-screen state. */
function Frame({ testID, children }: { testID: string; children: ReactNode }): JSX.Element {
  return (
    <Screen
      width="profile"
      appBar={{ variant: 'screen', title: null, onBack: leave }}
      testID={testID}
    >
      {children}
    </Screen>
  );
}

/** A full-screen state of the page: its sentence is the heading. */
function StateFrame({ children }: { children: ReactNode }): JSX.Element {
  return (
    <Frame testID={PERSON_TEST_IDS.screen}>
      <View style={STATE}>{children}</View>
    </Frame>
  );
}

/** The page while it loads: blocks in the shape of the header and of the offices held. */
function PersonLoading(): JSX.Element {
  return (
    <Frame testID={PERSON_TEST_IDS.loading}>
      <View style={PAGE}>
        <View style={LOADING_HEADER}>
          <Skeleton shape="circle" />
          <View {...QUIET} style={LOADING_LINES}>
            <Skeleton shape="line" lines={3} />
          </View>
        </View>
        <View {...QUIET} style={SECTION}>
          {Array.from({ length: LOADING_ROWS }, (_each, index) => (
            <Skeleton key={index} shape="row" />
          ))}
        </View>
      </View>
    </Frame>
  );
}

/** The page itself: the header every person gets, then the offices held, each a way to its office. */
function PersonPage({ vm }: { vm: ReadyPerson }): JSX.Element {
  const t = usePageT();
  const { data, stale } = vm;
  const { person, seats } = data;
  const last = seats.length - 1;
  return (
    <Screen
      width="profile"
      offline={stale}
      appBar={{ variant: 'screen', title: person.name, onBack: leave }}
      testID={PERSON_TEST_IDS.screen}
    >
      <View style={PAGE}>
        <ProfileHeader {...presentPersonHeader(data, t)} />
        {person.retiredAt === null ? null : (
          <View style={UNDER_HEADER}>
            <Notice
              kind="warning"
              text={t('profile:person.retired')}
              testID={PERSON_TEST_IDS.retiredNotice}
            />
          </View>
        )}
        <View style={SECTION}>
          <SectionHeader label={t('profile:person.seats')} />
          {seats.length === 0 ? (
            <View style={NONE}>
              <Text role="body">{t('profile:person.noSeats')}</Text>
            </View>
          ) : (
            seats.map((item, index) => (
              // A person may have held one office twice, so the place in the list is in the key.
              <ListRow
                key={`${item.seat.office.id}-${String(index)}`}
                {...presentSeatRow(item, t)}
                divider={index < last}
              />
            ))
          )}
        </View>
      </View>
    </Screen>
  );
}

/** SCR-c-slug: a person's page in every state of its view-model. */
export function PersonScreenView({ vm }: { vm: PersonViewModel }): JSX.Element {
  const t = usePageT();
  switch (vm.status) {
    case 'loading':
      return <PersonLoading />;
    case 'error':
      if (vm.code === 'not_found') {
        return (
          <StateFrame>
            <EmptyState
              kind="empty"
              art="chair"
              headingLevel={1}
              title={t('profile:notFound.title')}
              action={{
                label: t('profile:notFound.home'),
                href: '/',
                variant: 'secondary',
                testID: PERSON_TEST_IDS.notFoundAction,
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
              testID: PERSON_TEST_IDS.retry,
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
              testID: PERSON_TEST_IDS.retry,
            }}
          />
        </StateFrame>
      );
    case 'ready':
      return <PersonPage vm={vm} />;
    default:
      return assertNever(vm);
  }
}

export function PersonScreen({ slug }: PersonScreenProps): JSX.Element {
  const t = usePageT();
  const vm = usePersonViewModel(slug);
  const title = vm.status === 'ready' ? vm.data.person.name : t('profile:person.documentTitle');
  return (
    <>
      <head.Title>{t('common:documentTitle', { title })}</head.Title>
      <PersonScreenView vm={vm} />
    </>
  );
}
