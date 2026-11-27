import type {
  CandidacyView,
  ErrorCode,
  FieldReportInput,
  Issue,
  OfficeDetail,
} from '@citizenrun/shared';

import type { OfficeActions, PersonEntry } from '@/lib/view-models/common.types';
import type { ViewState } from '@/lib/view-state';

export type OfficeFieldReport = {
  status: 'idle' | 'sending' | 'sent' | 'error';
  errorCode: ErrorCode | null; // account_too_new, daily_limit_reached, link_invalid, office_retired, rate_limited, unavailable, internal
  onSubmit: (input: FieldReportInput) => void; // E-OFF-09
  onReset: () => void;
};

export type OfficeReadyData = {
  office: OfficeDetail; // unchanged; every nullable key stays null until drawn
  actions: OfficeActions;
  issues: readonly Issue[]; // for names and tiles
  signedIn: boolean;
  singleIssue: { issueId: string | null; onSelect: (issueId: string) => void } | null; // not null when office.impactMode is 'single_issue'
  candidates: {
    entries: readonly { candidacy: CandidacyView; entry: PersonEntry }[];
    total: number;
    onShowAll: (() => void) | null;
  };
  officeholders: readonly { holder: OfficeDetail['officeholders'][number]; entry: PersonEntry }[];
  mapRow: { onOpen: (() => void) | null }; // null until the map row's tap is built (MAP-mini-map)
  fieldReport: OfficeFieldReport | null; // null when logged out
  onOpenSource: (url: string) => void; // links.openExternal
  onRefresh: () => void;
};

export type OfficeViewModel = ViewState<OfficeReadyData>;
