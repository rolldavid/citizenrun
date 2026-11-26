import { assertNever } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { useRef, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import { errorText } from '@/features/onboarding/components/error-text';
import { IssuesControl } from '@/features/onboarding/components/issues-control';
import { IssuesSkeleton } from '@/features/onboarding/components/issues-skeleton';
import { StepFooter } from '@/features/onboarding/components/step-footer';
import { STEP_NAMESPACES } from '@/features/onboarding/components/step-translation';
import { useTight } from '@/features/onboarding/components/use-tight';
import type { OnboardingIssuesData } from '@/features/onboarding/view-models/issues.types';
import type { ViewState } from '@/lib/view-state';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import type { StickyFooterProps } from '@/ui/components/sticky-footer';
import { Text } from '@/ui/components/text';
import { useFocusOnMount } from '@/ui/focus';
import type { AppBarProps } from '@/ui/shells/app-bar';
import { space } from '@/ui/tokens';

/** The issues step's view-model: sign-up's, and the settings screen's, whose save can end in 'saved'. */
export type IssuesStepVm = ViewState<
  Omit<OnboardingIssuesData, 'submit'> & {
    submit: { status: 'idle' | 'sending' | 'saved'; errorCode: ErrorCode | null };
  }
>;

export type IssuesStepViewProps = {
  vm: IssuesStepVm;
  appBar: AppBarProps;
  /** The level 1 heading; null where the app bar's title is the heading. */
  heading: string | null;
  /** The grid's accessible name: the text of the screen's heading. */
  groupLabel: string;
  helper: string;
  primaryLabel: string;
  /** Whether the footer says the picks can be changed later. */
  showChangeLater: boolean;
  testIDs: { screen: string; primary: string; grid: string };
};

type IssuesStepData = Extract<IssuesStepVm, { status: 'ready' }>['data'];
type Selection = { picked: readonly string[]; starred: readonly string[] };
type Limit = 'selected' | 'starred';

const NOTHING_PICKED: Selection = { picked: [], starred: [] };

const CONTENT: ViewStyle = { paddingTop: space.x4, paddingBottom: space.x6 };
const HELPER: ViewStyle = { marginTop: space.x2 };
const CONTROL: ViewStyle = { marginTop: space.x6 };

/** The saved picks the list still holds, in the list's order. */
function savedSelection(data: IssuesStepData): Selection {
  const saved = new Map(data.initial.map((pick) => [pick.issueId, pick.starred]));
  const picked = data.issues.filter((issue) => saved.has(issue.id)).map((issue) => issue.id);
  return { picked, starred: picked.filter((id) => saved.get(id) === true) };
}

/** The selection with one issue picked or let go; an issue let go loses its star. */
function toggled(selection: Selection, issueId: string, data: IssuesStepData): Selection {
  if (selection.picked.includes(issueId)) {
    return {
      picked: selection.picked.filter((id) => id !== issueId),
      starred: selection.starred.filter((id) => id !== issueId),
    };
  }
  const picked = new Set([...selection.picked, issueId]);
  return {
    picked: data.issues.filter((issue) => picked.has(issue.id)).map((issue) => issue.id),
    starred: selection.starred,
  };
}

/** The selection with one picked issue's star set or taken away. */
function starToggled(selection: Selection, issueId: string): Selection {
  if (selection.starred.includes(issueId)) {
    return { ...selection, starred: selection.starred.filter((id) => id !== issueId) };
  }
  if (!selection.picked.includes(issueId)) {
    return selection;
  }
  return { ...selection, starred: [...selection.starred, issueId] };
}

/**
 * The issues step: pick 3 to 10 issues and star up to 3. Sign-up draws it with the step bar, and
 * the settings screen draws it under its own app bar. The picks are the screen's own until the
 * footer's button hands them over, in the list's order.
 */
export function IssuesStepView({
  vm,
  appBar,
  heading,
  groupLabel,
  helper,
  primaryLabel,
  showChangeLater,
  testIDs,
}: IssuesStepViewProps): JSX.Element {
  const { t } = useTranslation(STEP_NAMESPACES);
  const tight = useTight();
  const headingRef = useRef<TextInstance>(null);
  // A screen reader announces the step by its heading.
  useFocusOnMount(headingRef);
  const [chosen, setChosen] = useState<Selection | null>(null);
  const [limitHit, setLimitHit] = useState<Limit | null>(null);

  // The saved picks are taken once, the first time the issues are there.
  let selection = chosen ?? NOTHING_PICKED;
  if (chosen === null && vm.status === 'ready') {
    selection = savedSelection(vm.data);
    setChosen(selection);
  }

  const change = (next: Selection): void => {
    setChosen(next);
    setLimitHit(null);
  };

  const countLine = t('onboarding:issues.count', {
    picked: selection.picked.length,
    starred: selection.starred.length,
  });
  const info = (line: string): NonNullable<StickyFooterProps['info']> =>
    showChangeLater ? { line, helper: t('onboarding:issues.changeLater') } : { line };

  const limitLine = (limit: Limit): string => {
    switch (limit) {
      case 'selected':
        return t('onboarding:issues.maxPicked');
      case 'starred':
        return t('onboarding:issues.maxStarred');
      default:
        return assertNever(limit);
    }
  };

  const readyPrimary = (data: IssuesStepData, stale: boolean): StickyFooterProps['primary'] => {
    if (stale) {
      return {
        label: t('common:states.offlineAction'),
        disabled: true,
        testID: testIDs.primary,
      };
    }
    if (selection.picked.length < data.limits.min) {
      return { label: t('onboarding:issues.needMore'), disabled: true, testID: testIDs.primary };
    }
    return {
      label: primaryLabel,
      onPress: () => {
        data.onContinue(
          selection.picked.map((issueId) => ({
            issueId,
            starred: selection.starred.includes(issueId),
          })),
        );
      },
      busy: data.submit.status === 'sending',
      testID: testIDs.primary,
    };
  };

  const footerOf = (): JSX.Element | null => {
    switch (vm.status) {
      case 'loading':
        return (
          <StepFooter
            notice={null}
            footer={{
              info: info(countLine),
              primary: { label: t('common:ui.loading'), disabled: true, testID: testIDs.primary },
            }}
          />
        );
      case 'ready': {
        const { errorCode } = vm.data.submit;
        const primary = readyPrimary(vm.data, vm.stale);
        return (
          <StepFooter
            notice={errorCode === null ? null : { text: errorText(errorCode, t) }}
            footer={{
              info: info(limitHit === null ? countLine : limitLine(limitHit)),
              ...(primary === undefined ? {} : { primary }),
            }}
          />
        );
      }
      case 'error':
      case 'offline':
        return null;
      default:
        return assertNever(vm);
    }
  };

  const controlOf = (): JSX.Element => {
    switch (vm.status) {
      case 'loading':
        return <IssuesSkeleton />;
      case 'ready': {
        const { data } = vm;
        return (
          <IssuesControl
            issues={data.issues}
            label={groupLabel}
            picked={selection.picked}
            starred={selection.starred}
            limits={data.limits}
            onToggle={(issueId) => {
              change(toggled(selection, issueId, data));
            }}
            onToggleStar={(issueId) => {
              change(starToggled(selection, issueId));
            }}
            onLimit={setLimitHit}
            testID={testIDs.grid}
          />
        );
      }
      case 'error':
        // The step's heading stays the screen's heading.
        return (
          <EmptyState
            kind="error"
            art="chair"
            headingLevel={2}
            title={t('common:states.errorTitle')}
            body={errorText(vm.code, t)}
            action={{
              label: t('common:ui.retry'),
              onPress: vm.onRetry,
              testID: `${testIDs.screen}-retry`,
            }}
          />
        );
      case 'offline':
        return (
          <EmptyState
            art="chair"
            headingLevel={2}
            title={t('common:states.offlineTitle')}
            body={t('common:states.offlineBody')}
            action={{
              label: t('common:ui.retry'),
              onPress: vm.onRetry,
              testID: `${testIDs.screen}-retry`,
            }}
          />
        );
      default:
        return assertNever(vm);
    }
  };

  const failed = vm.status === 'error' || vm.status === 'offline';

  return (
    <Screen
      width="column"
      appBar={appBar}
      offline={vm.status === 'ready' && vm.stale}
      footer={footerOf()}
      testID={testIDs.screen}
    >
      <View style={CONTENT}>
        {heading === null ? null : (
          <Text ref={headingRef} role={tight ? 'title' : 'display'} heading={1}>
            {heading}
          </Text>
        )}
        <View style={heading === null ? null : HELPER}>
          <Text role="body" tone="secondary">
            {helper}
          </Text>
        </View>
        {/* An empty state brings its own room above it. */}
        <View style={failed ? null : CONTROL}>{controlOf()}</View>
      </View>
    </Screen>
  );
}
