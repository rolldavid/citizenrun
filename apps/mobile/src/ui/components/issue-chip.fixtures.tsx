import type { ColorToken } from '@/ui/tokens';

import type { IssueChipProps } from './issue-chip';
import type { InteractionPreviewState } from './pressable';

const press = (): void => undefined;

export const STATES = {
  idle: {
    issueId: 'rent-housing',
    name: 'Rent',
    label: 'Rent and housing costs',
    onPress: press,
    testID: 'gallery.issue-chip-idle',
  },
  selected: {
    issueId: 'rent-housing',
    name: 'Rent',
    label: 'Rent and housing costs',
    selected: true,
    onPress: press,
    testID: 'gallery.issue-chip-selected',
  },
  selectedStarred: {
    issueId: 'schools',
    name: 'Schools',
    selected: true,
    onPress: press,
    star: { starred: true, onToggle: press, label: 'Star Schools' },
    testID: 'gallery.issue-chip-selected-starred',
  },
  selectedUnstarred: {
    issueId: 'wages-workers',
    name: 'Wages',
    label: 'Wages and worker power',
    selected: true,
    onPress: press,
    star: { starred: false, onToggle: press, label: 'Star Wages' },
    testID: 'gallery.issue-chip-selected-unstarred',
  },
  // Display only: no target.
  displayMd: {
    issueId: 'transit',
    name: 'Transit',
    testID: 'gallery.issue-chip-display-md',
  },
  displaySm: {
    issueId: 'water-land',
    name: 'Water and land',
    size: 'sm',
    testID: 'gallery.issue-chip-display-sm',
  },
  // A name that takes a second line, and no more than that at 130% text: the chip grows.
  longName: {
    issueId: 'nominations',
    name: 'Who gets nominated, from the county up to Congress',
    onPress: press,
    testID: 'gallery.issue-chip-long-name',
  },
  // An id this build does not know: a neutral tile, the name as it came.
  unknown: {
    issueId: 'not-an-issue',
    name: 'New issue',
    onPress: press,
    testID: 'gallery.issue-chip-unknown',
  },
  idleHovered: {
    issueId: 'rent-housing',
    name: 'Rent',
    label: 'Rent and housing costs',
    onPress: press,
    testID: 'gallery.issue-chip-idle-hovered',
  },
  idlePressed: {
    issueId: 'rent-housing',
    name: 'Rent',
    label: 'Rent and housing costs',
    onPress: press,
    testID: 'gallery.issue-chip-idle-pressed',
  },
  idleFocused: {
    issueId: 'rent-housing',
    name: 'Rent',
    label: 'Rent and housing costs',
    onPress: press,
    testID: 'gallery.issue-chip-idle-focused',
  },
} as const satisfies Readonly<Record<string, IssueChipProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  idleHovered: { hovered: true },
  idlePressed: { pressed: true },
  idleFocused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
