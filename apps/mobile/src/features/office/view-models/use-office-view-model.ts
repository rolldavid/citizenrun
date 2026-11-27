import { useState } from 'react';

import { navigateTo, signInHref } from '@/lib/navigation';
import { useSessionPresence } from '@/lib/session-state';
import { querySource, useIsOnline, viewStateOf } from '@/lib/view-models/query';
import { links } from '@/platform/links';

import { useFieldReport } from '../data/use-field-report';
import { useIssues } from '../data/use-issues';
import { useOffice } from '../data/use-office';
import { useOfficeCandidates } from '../data/use-office-candidates';
import { useOfficeToggles } from '../data/use-office-toggles';

import { buildOffice } from './office.build';
import type { OfficeReadyData, OfficeViewModel } from './office.types';

/** What the viewer chose on this office's page; it starts over when the slug changes. */
type Choice = { slug: string; issueId: string | null; showAll: boolean };

/** SCR-office-slug. */
export function useOfficeViewModel(slug: string): OfficeViewModel {
  const [choice, setChoice] = useState<Choice>({ slug, issueId: null, showAll: false });
  const ownChoice = choice.slug === slug;
  const issueId = ownChoice ? choice.issueId : null;
  const showAll = ownChoice && choice.showAll;

  const office = useOffice(slug, issueId);
  const issues = useIssues();
  // 'absent' and 'unknown' (before the session is read) both count as signed out here.
  const signedIn = useSessionPresence() === 'present';
  const toggles = useOfficeToggles();
  const officeId = office.data?.id ?? null;
  const candidates = useOfficeCandidates(officeId, showAll);
  const report = useFieldReport(officeId);
  const online = useIsOnline();

  const detail = office.data;
  const signInFirst = (): boolean => {
    if (signedIn) {
      return false;
    }
    // A signed-out press never sends a request: it goes to sign-in and comes back here.
    navigateTo(signInHref(`/office/${slug}`));
    return true;
  };

  const callbacks = {
    onToggleFollow: () => {
      if (signInFirst() || detail === undefined) {
        return;
      }
      toggles.setFollowing(detail.id, !detail.viewer.following);
    },
    onToggleBookmark: () => {
      if (signInFirst() || detail === undefined) {
        return;
      }
      toggles.setBookmarked(detail.id, !detail.viewer.bookmarked);
    },
    onShowAll: () => {
      setChoice({ slug, issueId, showAll: true });
    },
    onSelectIssue: (id: string) => {
      setChoice({ slug, issueId: id, showAll });
    },
    onOpenSource: (url: string) => {
      void links.openExternal(url);
    },
    onRefresh: () => {
      void office.refetch();
      if (showAll) {
        candidates.refetch();
      }
    },
  };

  const view = viewStateOf<OfficeReadyData | null>(
    [querySource(office), querySource(issues)],
    () =>
      detail === undefined || issues.data === undefined
        ? null
        : buildOffice({
            office: detail,
            issues: issues.data,
            signedIn,
            allCandidates: candidates.items,
            candidatesComplete: candidates.items !== null && !candidates.hasNextPage,
            fieldReport: report,
            callbacks,
          }),
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
