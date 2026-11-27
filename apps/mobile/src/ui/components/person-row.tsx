import type { JSX, ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { space } from '@/ui/tokens';

import { Avatar } from './avatar';
import { ListRow } from './list-row';
import type { ListRowProps } from './list-row';
import { Tag } from './tag';
import { Text } from './text';

export type PersonRowProps = {
  /** The person's photo; null draws the initials. */
  image: { key: string; url: string } | null;
  name: string | null;
  /** In mono after the name; null for a person from public records. */
  handle: string | null;
  /** One caption line: an office and place, a filing, a reason. */
  line: string | null;
  /** A status or a party word (PC6A-14). */
  tag: { label: string; variant: 'solid' | 'outline' } | null;
  /** A small C-FollowButton or C-Button. */
  action: ReactElement | null;
  /** Null: not a link (a blocked account, a roster-only person). */
  href: string | null;
  testID: string;
};

// The tag, then the line; the line goes under a tag too wide to share its row.
const TAGGED_LINE: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: space.x2,
  marginTop: space.x1,
};
const LINE: ViewStyle = { flexShrink: 1 };
// The handle takes the room the name leaves, and is cut short before the name is.
const HANDLE: ViewStyle = { flex: 1, minWidth: 0 };

/**
 * C-PersonRow: a person or an account as one row of C-ListRow. A round avatar, the name with the
 * handle after it, one caption line, and at the right the action, else the tag, else a chevron on a
 * link. With both a tag and an action the tag moves in front of the line. Every person gets the
 * same row: no adjective, no party color, no different look for a holder and a challenger.
 */
export function PersonRow({
  image,
  name,
  handle,
  line,
  tag,
  action,
  href,
  testID,
}: PersonRowProps): JSX.Element {
  const mark = tag === null ? null : <Tag label={tag.label} variant={tag.variant} />;
  const tagInLine = mark !== null && action !== null;

  const subtitle: ReactNode = tagInLine ? (
    <View style={TAGGED_LINE}>
      {mark}
      {line === null ? null : (
        <View style={LINE}>
          <Text role="caption" tone="secondary">
            {line}
          </Text>
        </View>
      )}
    </View>
  ) : (
    line
  );
  const trailing: ListRowProps['trailing'] =
    action !== null
      ? { kind: 'action', node: action }
      : mark !== null
        ? { kind: 'tag', node: mark }
        : href !== null
          ? { kind: 'chevron' }
          : undefined;

  return (
    <ListRow
      size="regular"
      // The name is printed beside it.
      leading={<Avatar size="sm" image={image} name={name} handle={handle} decorative={true} />}
      title={name ?? handle ?? ''}
      {...(name === null || handle === null
        ? {}
        : {
            titleSuffix: (
              <View style={HANDLE}>
                <Text role="mono" tone="secondary" numberOfLines={1}>
                  {handle}
                </Text>
              </View>
            ),
          })}
      {...(subtitle === null ? {} : { subtitle })}
      {...(trailing === undefined ? {} : { trailing })}
      {...(href === null ? {} : { href })}
      testID={testID}
    />
  );
}
