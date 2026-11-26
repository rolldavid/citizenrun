import type { JSX, ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { HoverGroundContext } from './hover-ground';
import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

export type ListRowProps = {
  /** C-Avatar, C-OfficeTile, C-IssueTile, C-Icon or C-Checkbox. */
  leading?: ReactNode;
  title: string;
  /** After the title on its line: a handle in mono after a name. */
  titleSuffix?: ReactNode;
  /** A caption line: a string, cut at one line, or C-Text nodes, drawn as given. */
  subtitle?: ReactNode;
  trailing?:
    | { kind: 'chevron' }
    /** A current setting. */
    | { kind: 'value'; text: string }
    | { kind: 'count'; value: number }
    /** A C-Tag. */
    | { kind: 'tag'; node: ReactElement }
    /** A small C-Button, C-FollowButton or C-Checkbox; never a C-Switch. */
    | { kind: 'action'; node: ReactElement };
  /** A round dot at the right. */
  unread?: boolean;
  /** Default 'regular'. */
  size?: 'regular' | 'compact';
  /** Default true: a soft rule under the row. */
  divider?: boolean;
  onPress?: () => void;
  href?: string;
  /** The title in the danger color: a row that opens a destructive dialog. */
  destructive?: boolean;
  testID: string;
};

const LEADING: ViewStyle = { marginRight: space.x3 };
const WORDS: ViewStyle = { flex: 1, minWidth: 0 };
const TITLE_LINE: ViewStyle = { flexDirection: 'row', alignItems: 'baseline', gap: space.x1 };
const TITLE: ViewStyle = { flexShrink: 1 };
// The dot and the trailing element: 8 between them, 12 from the words.
const TAIL: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x2,
  marginLeft: space.x3,
};
const DOT: ViewStyle = {
  width: size.unreadDot,
  height: size.unreadDot,
  borderRadius: radius.full,
};
// The part of a row that is a link while its action is a target of its own.
const LINK_PART: ViewStyle = { flex: 1, minWidth: 0 };
const LINK_LINE: ViewStyle = { flexDirection: 'row', alignItems: 'center' };
// Out of the row's layout, so a word space takes no room in it.
const WORD_SPACE: ViewStyle = { position: 'absolute' };

/**
 * A space between two parts of what a row says. Each part stands in a box of its own with nothing
 * between them in the page's text, where the last word of one would run into the first word of the
 * next. It draws nothing and no screen reader meets it.
 */
function WordSpace(): JSX.Element {
  return (
    <View style={WORD_SPACE}>
      <Text role="caption" hidden={true}>
        {' '}
      </Text>
    </View>
  );
}

/**
 * C-ListRow: the row of every list. A leading element, a title over one caption line, and one
 * trailing element. With `onPress` or `href` the whole row is one target that fills under a pointer
 * and while pressed and never moves. A row whose trailing element is an action is a target only
 * with `href`, and then the action stands beside the link, never inside it.
 */
export function ListRow({
  leading,
  title,
  titleSuffix,
  subtitle,
  trailing,
  unread = false,
  size: sizeName = 'regular',
  divider = true,
  onPress,
  href,
  destructive = false,
  testID,
}: ListRowProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const least = sizeName === 'compact' ? size.listRowCompact : size.listRowMin;
  const frame: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: least,
    paddingVertical: space.x2,
    ...(divider
      ? { borderBottomWidth: rule.hairline, borderBottomColor: theme.color.ruleSoft }
      : {}),
  };

  const worded = typeof subtitle === 'string' ? `${title}. ${subtitle}` : title;
  // A setting or a count printed at the row's end is part of what the row says.
  const printed =
    trailing?.kind === 'value'
      ? trailing.text
      : trailing?.kind === 'count'
        ? String(trailing.value)
        : null;
  const said = printed === null ? worded : `${worded}. ${printed}`;
  const name = unread ? t('ui.row.unread', { label: said }) : said;
  const action = trailing?.kind === 'action' ? trailing.node : null;

  const titleText = (
    <Text role="label" tone={destructive ? 'danger' : 'primary'} numberOfLines={2}>
      {title}
    </Text>
  );
  /** The leading element and the words; `onFill` while the row shows its hover or pressed fill. */
  const body = (onFill: boolean): ReactNode => (
    <>
      {leading === undefined ? null : (
        <View style={LEADING}>
          <HoverGroundContext.Provider value={onFill}>{leading}</HoverGroundContext.Provider>
        </View>
      )}
      <View style={WORDS}>
        {titleSuffix === undefined ? (
          titleText
        ) : (
          <View style={TITLE_LINE}>
            <View style={TITLE}>{titleText}</View>
            {titleSuffix}
          </View>
        )}
        {typeof subtitle === 'string' ? (
          <>
            <WordSpace />
            <Text role="caption" tone="secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          </>
        ) : (
          subtitle
        )}
        {/* The setting or the count stands after the words, in the tail. */}
        {printed === null ? null : <WordSpace />}
      </View>
    </>
  );
  const dot = unread ? (
    <View
      style={[DOT, { backgroundColor: theme.color.text }]}
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    />
  ) : null;
  const last =
    trailing === undefined ? null : trailing.kind === 'chevron' ? (
      <Icon name="chevronRight" size="medium" tone="secondary" />
    ) : trailing.kind === 'value' ? (
      <Text role="caption" tone="secondary">
        {trailing.text}
      </Text>
    ) : trailing.kind === 'count' ? (
      <Text role="label" tabular={true}>
        {String(trailing.value)}
      </Text>
    ) : (
      trailing.node
    );

  if (href !== undefined && action !== null) {
    // The link holds the leading element, the words and the dot; the action is its sibling, so a
    // press on one never reaches the other.
    return (
      <View style={frame}>
        <View style={LINK_PART}>
          <Pressable
            role="link"
            href={href}
            {...(onPress === undefined ? {} : { onPress })}
            label={name}
            hover="fill"
            feedback="fill"
            radius={radius.none}
            testID={testID}
          >
            {({ hovered, pressed }) => (
              <View style={[LINK_LINE, { minHeight: least - space.x2 * 2 }]}>
                {body(hovered || pressed)}
                {dot === null ? null : <View style={TAIL}>{dot}</View>}
              </View>
            )}
          </Pressable>
        </View>
        <View style={TAIL}>{action}</View>
      </View>
    );
  }

  const tail =
    dot === null && last === null ? null : (
      <View style={TAIL}>
        {dot}
        {last}
      </View>
    );

  if (action !== null || (href === undefined && onPress === undefined)) {
    return (
      <View style={frame} testID={testID}>
        {body(false)}
        {tail}
      </View>
    );
  }
  return (
    <Pressable
      role={href === undefined ? 'button' : 'link'}
      {...(href === undefined ? {} : { href })}
      {...(onPress === undefined ? {} : { onPress })}
      label={name}
      hover="fill"
      feedback="fill"
      radius={radius.none}
      testID={testID}
    >
      {({ hovered, pressed }) => (
        <View style={frame}>
          {body(hovered || pressed)}
          {tail}
        </View>
      )}
    </Pressable>
  );
}
