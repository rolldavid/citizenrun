import type { ColorToken } from '@/ui/tokens';

import type { IssueGridProps } from './issue-grid';
import type { InteractionPreviewState } from './pressable';

const noop = (): void => undefined;

/** The 19 issues in their order: the short name a chip prints, and the full name it is read by. */
const ISSUES: IssueGridProps['issues'] = [
  { id: 'rent-housing', name: 'Rent', label: 'Rent and housing costs' },
  { id: 'utility-bills', name: 'Utility bills', label: 'Power and utility bills' },
  { id: 'data-centers-ai', name: 'Data centers', label: 'Data centers and AI' },
  { id: 'climate', name: 'Climate' },
  {
    id: 'corporate-subsidies',
    name: 'Corporate subsidies',
    label: 'Corporate tax breaks and subsidies',
  },
  { id: 'property-taxes', name: 'Property taxes', label: 'Property taxes and fair assessment' },
  { id: 'wages-workers', name: 'Wages', label: 'Wages and worker power' },
  { id: 'policing-justice', name: 'Policing', label: 'Policing, prosecution and jails' },
  { id: 'healthcare', name: 'Healthcare', label: 'Healthcare costs and access' },
  { id: 'medicare-for-all', name: 'Medicare for All' },
  { id: 'schools', name: 'Schools' },
  { id: 'water-land', name: 'Water and land', label: 'Water, land and environment' },
  { id: 'transit', name: 'Transit' },
  { id: 'voting-access', name: 'Voting access', label: 'Elections and voting access' },
  { id: 'money-in-politics', name: 'Money in politics' },
  { id: 'nominations', name: 'Nominations', label: 'Who gets nominated, up to Congress' },
  { id: 'public-money', name: 'Public money', label: 'Public money and divestment' },
  { id: 'defund-israel', name: 'Defunding Israel' },
  { id: 'foreign-wars', name: 'Foreign wars', label: 'Foreign wars and military spending' },
];

const SHARED = {
  issues: ISSUES,
  label: 'What do you want to change?',
  maxSelected: 10,
  maxStarred: 3,
  onToggle: noop,
  onToggleStar: noop,
  onLimit: noop,
} as const;

export const STATES = {
  none: { ...SHARED, selectedIds: [], starredIds: [], testID: 'gallery.issue-grid-none' },
  // 3 picked, 1 starred.
  three: {
    ...SHARED,
    selectedIds: ['rent-housing', 'utility-bills', 'property-taxes'],
    starredIds: ['rent-housing'],
    testID: 'gallery.issue-grid-three',
  },
  // 10 picked and 3 starred: both limits are met.
  ten: {
    ...SHARED,
    selectedIds: [
      'rent-housing',
      'utility-bills',
      'data-centers-ai',
      'climate',
      'corporate-subsidies',
      'property-taxes',
      'wages-workers',
      'policing-justice',
      'healthcare',
      'medicare-for-all',
    ],
    starredIds: ['rent-housing', 'climate', 'wages-workers'],
    testID: 'gallery.issue-grid-ten',
  },
} as const satisfies Readonly<Record<string, IssueGridProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
