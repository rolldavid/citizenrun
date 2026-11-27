import type { CandidacyView, Issue, OfficeDetail, PersonSummary } from '@citizenrun/shared';

import type { PersonEntry } from '@/lib/view-models/common.types';
import { runStateFor } from '@/lib/view-models/run-state';

import type { FieldReportState } from '../data/use-field-report';

import type { OfficeReadyData } from './office.types';

export type OfficeBuildInput = {
  office: OfficeDetail;
  issues: readonly Issue[];
  signedIn: boolean;
  allCandidates: readonly CandidacyView[] | null; // E-OFF-02 pages once "Show all" ran, else null
  candidatesComplete: boolean; // the pages are all loaded
  fieldReport: FieldReportState;
  callbacks: {
    onToggleFollow: () => void;
    onToggleBookmark: () => void;
    onShowAll: () => void;
    onSelectIssue: (issueId: string) => void;
    onOpenSource: (url: string) => void;
    onRefresh: () => void;
  };
};

/** A person's row: a link to their page, or none for a person kept only on a roster. */
function personEntry(person: PersonSummary): PersonEntry {
  return {
    person,
    href: person.rosterOnly ? null : `/c/${person.slug}`,
    // Person follows are not offered here.
    onToggleFollow: null,
  };
}

/** The office page's ready data from its queries; the office itself is passed through unchanged. */
export function buildOffice(input: OfficeBuildInput): OfficeReadyData {
  const { office, callbacks, fieldReport } = input;
  const candidates = input.allCandidates ?? office.candidates;
  const entries = candidates.map((candidacy) => ({
    candidacy,
    entry: personEntry(candidacy.person),
  }));
  const total = office.candidatesCount;
  return {
    office,
    actions: {
      // Run is not built yet, so its slot stays hidden.
      ...runStateFor(office, false),
      following: office.viewer.following,
      bookmarked: office.viewer.bookmarked,
      onRun: () => undefined,
      onToggleFollow: callbacks.onToggleFollow,
      onToggleBookmark: callbacks.onToggleBookmark,
    },
    issues: input.issues,
    signedIn: input.signedIn,
    singleIssue:
      office.impactMode === 'single_issue'
        ? { issueId: office.impactIssueId, onSelect: callbacks.onSelectIssue }
        : null,
    candidates: {
      entries,
      total,
      onShowAll: total > entries.length && !input.candidatesComplete ? callbacks.onShowAll : null,
    },
    officeholders: office.officeholders.map((holder) => ({
      holder,
      entry: personEntry(holder.person),
    })),
    mapRow: { onOpen: null },
    fieldReport: input.signedIn
      ? {
          status: fieldReport.status,
          errorCode: fieldReport.errorCode,
          onSubmit: fieldReport.submit,
          onReset: fieldReport.reset,
        }
      : null,
    onOpenSource: callbacks.onOpenSource,
    onRefresh: callbacks.onRefresh,
  };
}
