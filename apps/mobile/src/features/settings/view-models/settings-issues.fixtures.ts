import type { Issue } from '@citizenrun/shared';

import { noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsIssuesViewModel } from './settings-issues.types';

type Ready = Extract<SettingsIssuesViewModel, { status: 'ready' }>;
type IssuesData = Extract<SettingsIssuesViewModel, { status: 'ready' }>['data'];
type Picks = IssuesData['initial'];

// The 19 issues in their order; written out here, since fixture files are not shared across features
const ISSUES: readonly Issue[] = [
  { id: 'rent-housing', name: 'Rent and housing costs', icon: 'rent-housing', sort: 1 },
  { id: 'utility-bills', name: 'Power and utility bills', icon: 'utility-bills', sort: 2 },
  { id: 'data-centers-ai', name: 'Data centers and AI', icon: 'data-centers-ai', sort: 3 },
  { id: 'climate', name: 'Climate', icon: 'climate', sort: 4 },
  {
    id: 'corporate-subsidies',
    name: 'Corporate tax breaks and subsidies',
    icon: 'corporate-subsidies',
    sort: 5,
  },
  {
    id: 'property-taxes',
    name: 'Property taxes and fair assessment',
    icon: 'property-taxes',
    sort: 6,
  },
  { id: 'wages-workers', name: 'Wages and worker power', icon: 'wages-workers', sort: 7 },
  {
    id: 'policing-justice',
    name: 'Policing, prosecution and jails',
    icon: 'policing-justice',
    sort: 8,
  },
  { id: 'healthcare', name: 'Healthcare costs and access', icon: 'healthcare', sort: 9 },
  { id: 'medicare-for-all', name: 'Medicare for All', icon: 'medicare-for-all', sort: 10 },
  { id: 'schools', name: 'Schools', icon: 'schools', sort: 11 },
  { id: 'water-land', name: 'Water, land and environment', icon: 'water-land', sort: 12 },
  { id: 'transit', name: 'Transit', icon: 'transit', sort: 13 },
  { id: 'voting-access', name: 'Elections and voting access', icon: 'voting-access', sort: 14 },
  { id: 'money-in-politics', name: 'Money in politics', icon: 'money-in-politics', sort: 15 },
  { id: 'nominations', name: 'Who gets nominated, up to Congress', icon: 'nominations', sort: 16 },
  { id: 'public-money', name: 'Public money and divestment', icon: 'public-money', sort: 17 },
  { id: 'defund-israel', name: 'Defunding Israel', icon: 'defund-israel', sort: 18 },
  {
    id: 'foreign-wars',
    name: 'Foreign wars and military spending',
    icon: 'foreign-wars',
    sort: 19,
  },
];

const SUBMIT_IDLE: IssuesData['submit'] = { status: 'idle', errorCode: null };

function readyWith(initial: Picks, submit: IssuesData['submit'] = SUBMIT_IDLE): Ready {
  return {
    status: 'ready',
    data: {
      issues: ISSUES,
      initial,
      limits: { min: 3, max: 10, maxStarred: 3 },
      submit,
      onContinue: noop,
      onBack: noop,
    },
    refreshing: false,
    stale: false,
  };
}

// Rent and schools starred
const FIVE: Picks = [
  { issueId: 'rent-housing', starred: true },
  { issueId: 'utility-bills', starred: false },
  { issueId: 'property-taxes', starred: false },
  { issueId: 'wages-workers', starred: false },
  { issueId: 'schools', starred: true },
];

export const settingsIssuesLoading = { status: 'loading' } satisfies SettingsIssuesViewModel;

export const settingsIssuesError = {
  status: 'error',
  code: 'internal',
  onRetry: noop,
} satisfies SettingsIssuesViewModel;

export const settingsIssuesOffline = {
  status: 'offline',
  onRetry: noop,
} satisfies SettingsIssuesViewModel;

export const settingsIssuesNone = readyWith([]) satisfies SettingsIssuesViewModel;

export const settingsIssuesStale = {
  ...readyWith([]),
  stale: true,
} satisfies SettingsIssuesViewModel;

export const settingsIssuesTwo = readyWith([
  { issueId: 'rent-housing', starred: false },
  { issueId: 'schools', starred: false },
]) satisfies SettingsIssuesViewModel;

export const settingsIssuesFive = readyWith(FIVE) satisfies SettingsIssuesViewModel;

export const settingsIssuesTen = readyWith(
  ISSUES.slice(0, 10).map((issue, index) => ({ issueId: issue.id, starred: index < 2 })),
) satisfies SettingsIssuesViewModel;

export const settingsIssuesStarLimit = readyWith(
  FIVE.map((pick) => ({
    issueId: pick.issueId,
    starred: pick.starred || pick.issueId === 'utility-bills',
  })),
) satisfies SettingsIssuesViewModel;

export const settingsIssuesSending = readyWith(FIVE, {
  status: 'sending',
  errorCode: null,
}) satisfies SettingsIssuesViewModel;

export const settingsIssuesSubmitError = readyWith(FIVE, {
  status: 'idle',
  errorCode: 'unknown_issue',
}) satisfies SettingsIssuesViewModel;

// Tightness is the window's and the text size's, not the data's
export const settingsIssuesTight = readyWith(FIVE) satisfies SettingsIssuesViewModel;

export const settingsIssuesSaved = readyWith(FIVE, {
  status: 'saved',
  errorCode: null,
}) satisfies SettingsIssuesViewModel;
