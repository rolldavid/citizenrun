import type { ColorToken } from '@/ui/tokens';

import { Avatar } from './avatar';
import { Button } from './button';
import { Icon } from './icon';
import { IssueTile } from './issue-tile';
import type { ListRowProps } from './list-row';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

const press = (): void => undefined;

/** The small button a row carries as its action. */
function edit(testID: string): NonNullable<ListRowProps['trailing']> {
  return {
    kind: 'action',
    node: <Button variant="secondary" size="sm" label="Edit" testID={testID} onPress={press} />,
  };
}

export const STATES = {
  chevron: {
    title: 'Notifications',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-chevron',
  },
  value: {
    title: 'Theme',
    trailing: { kind: 'value', text: 'System' },
    onPress: press,
    testID: 'gallery.list-row-value',
  },
  count: {
    title: 'Offices you follow',
    trailing: { kind: 'count', value: 128 },
    onPress: press,
    testID: 'gallery.list-row-count',
  },
  // The button is the only target: the row itself is not pressable.
  action: {
    title: 'Handle',
    subtitle: '@carol_wynn',
    trailing: edit('gallery.list-row-action-edit'),
    testID: 'gallery.list-row-action',
  },
  // A link with a button beside it: each is pressed by itself.
  hrefWithAction: {
    title: 'Dana Okafor',
    subtitle: 'Running for Alder City Council',
    trailing: edit('gallery.list-row-href-with-action-edit'),
    href: '/dev/gallery',
    testID: 'gallery.list-row-href-with-action',
  },
  avatarLeading: {
    leading: (
      <Avatar size="sm" image={null} name="Carol Wynn" handle="carol_wynn" decorative={true} />
    ),
    title: 'Carol Wynn',
    titleSuffix: (
      <Text role="mono" tone="secondary">
        @carol_wynn
      </Text>
    ),
    subtitle: 'Wren County Treasurer',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-avatar-leading',
  },
  iconLeading: {
    leading: <Icon name="lock" tone="primary" />,
    title: 'Privacy',
    subtitle: 'Who can message you',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-icon-leading',
  },
  // The tile keeps its keyline: a hovered row puts it on the hover fill.
  issueLeading: {
    leading: <IssueTile issueId="rent-housing" keyline={true} />,
    title: 'Rent',
    subtitle: '12 offices near Alder',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-issue-leading',
  },
  subtitle: {
    title: 'Wren County Clerk',
    subtitle: 'Keeps the filing dates for county offices',
    testID: 'gallery.list-row-subtitle',
  },
  longTitle: {
    title:
      'Wren County Board of Supervisors, District 3, the seat for Alder, East Alder and the unincorporated land north of the river',
    subtitle: 'Filing closes Fri, Nov 27',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-long-title',
  },
  unread: {
    title: 'Dana Okafor',
    subtitle: 'Are you thinking of running?',
    unread: true,
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-unread',
  },
  compact: {
    title: 'Wren County Clerk',
    size: 'compact',
    onPress: press,
    testID: 'gallery.list-row-compact',
  },
  noDivider: {
    title: 'Notifications',
    trailing: { kind: 'chevron' },
    divider: false,
    onPress: press,
    testID: 'gallery.list-row-no-divider',
  },
  destructive: {
    title: 'Delete account',
    destructive: true,
    onPress: press,
    testID: 'gallery.list-row-destructive',
  },
  chevronHovered: {
    title: 'Notifications',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-chevron-hovered',
  },
  chevronPressed: {
    title: 'Notifications',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-chevron-pressed',
  },
  chevronFocused: {
    title: 'Notifications',
    trailing: { kind: 'chevron' },
    onPress: press,
    testID: 'gallery.list-row-chevron-focused',
  },
} as const satisfies Readonly<Record<string, ListRowProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  chevronHovered: { hovered: true },
  chevronPressed: { pressed: true },
  chevronFocused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
