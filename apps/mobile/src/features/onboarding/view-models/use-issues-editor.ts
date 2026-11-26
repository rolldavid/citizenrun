import type { Me } from '@citizenrun/shared';
import { useRef, useState } from 'react';

import { useMe, writeMeToCache } from '@/features/system';
import { goBack } from '@/lib/navigation';
import type { Href } from '@/lib/view-models/common.types';
import { failureCode, useIsOnline, viewStateOf } from '@/lib/view-models/query';
import { queryClient } from '@/platform/query-client';

import { setIssues } from '../data/onboarding-requests';
import { useIssues } from '../data/use-issues';

import { buildIssuesStep, issuesBody } from './issues.build';
import type { OnboardingIssuesData, OnboardingIssuesViewModel } from './issues.types';

type Submit = OnboardingIssuesData['submit'];

const SUBMIT_IDLE: Submit = { status: 'idle', errorCode: null };
const SUBMIT_SENDING: Submit = { status: 'sending', errorCode: null };

/** The issues control of SCR-onboarding-issues and SCR-settings-issues: E-REF-01, then E-ME-09. */
export function useIssuesEditor(options: {
  onSaved: (me: Me) => void;
  backTo: Href;
}): OnboardingIssuesViewModel {
  const { issues, source: issuesSource } = useIssues();
  const { me, source: meSource } = useMe();
  const online = useIsOnline();
  const [submit, setSubmit] = useState<Submit>(SUBMIT_IDLE);
  const sending = useRef(false);

  // Issue picks are private: never logged, never in a URL
  const onContinue = (picked: readonly { issueId: string; starred: boolean }[]): void => {
    if (!online || sending.current || issues === null) return;
    const body = issuesBody(picked, issues);
    if (body === null) return;
    sending.current = true;
    setSubmit(SUBMIT_SENDING);
    void setIssues(body).then((outcome) => {
      sending.current = false;
      if (outcome.ok) {
        setSubmit(SUBMIT_IDLE);
        writeMeToCache(queryClient.get(), outcome.value);
        options.onSaved(outcome.value);
        return;
      }
      const code = failureCode(outcome.failure);
      setSubmit({ status: 'idle', errorCode: code });
      if (code === 'unknown_issue') {
        void issuesSource.refetch();
      }
    });
  };

  const onBack = (): void => {
    goBack(options.backTo);
  };

  const view = viewStateOf<OnboardingIssuesData | null>(
    [issuesSource, meSource],
    () =>
      issues === null || me === null
        ? null
        : { ...buildIssuesStep({ issues, me }), submit, onContinue, onBack },
    online,
  );
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return { ...view, data: view.data };
}
