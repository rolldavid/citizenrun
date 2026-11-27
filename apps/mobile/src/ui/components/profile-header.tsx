import { Fragment, useState } from 'react';
import type { JSX, ReactElement } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { size, space } from '@/ui/tokens';

import { Avatar } from './avatar';
import { Link } from './link';
import { MeasureRuns, wordsOf } from './measure-runs';
import { PhotoCredit } from './photo-credit';
import { Text } from './text';

export type ProfileHeaderProps = {
  image: { key: string; url: string } | null;
  name: string | null;
  /** Null for a person nobody has claimed. */
  handle: string | null;
  /** A C-Tag: the current candidacy status. */
  tag: ReactElement | null;
  /** Caption lines under the name: an office and place, "Created from public filings". */
  lines: readonly string[];
  bio: string | null;
  link: { href: string; domain: string } | null;
  photoCredit: string | null;
  /** Not drawn yet: the row of counts comes with the profiles of accounts. */
  stats: readonly { id: string; text: string; href?: string; onPress?: () => void }[];
  /** C-FollowButton, C-Button, C-IconButton, in order. */
  actions: readonly ReactElement[];
  /** "You blocked this account.": replaces the lines, the bio, the link and the photo credit. */
  notice: string | null;
  testID: string;
};

const ROW: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', gap: space.x4 };
// The credit wraps under the photo, at the photo's width, or at its longest word's where that is
// wider, so a word is never broken (a long word at a large text size).
const PHOTO_WIDTH = size.avatar.xl;
const WORDS: ViewStyle = { flex: 1, minWidth: 0, gap: space.x1 };
const NAME_LINE: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: space.x2,
  rowGap: space.x1,
};
const NAME: ViewStyle = { flexShrink: 1 };
const ACTIONS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: space.x2,
  marginTop: space.x3,
};

/**
 * C-ProfileHeader: the top of a person's or an account's page. A round photo or the initials, the
 * name with its tag, the handle, the caption lines, the bio and the link, then the actions in one
 * wrapping row. A notice stands in for everything under the name but the actions. Every person
 * gets the same header: no issues, no location, no square photo.
 */
export function ProfileHeader({
  image,
  name,
  handle,
  tag,
  lines,
  bio,
  link,
  photoCredit,
  actions,
  notice,
  testID,
}: ProfileHeaderProps): JSX.Element {
  const blocked = notice !== null;
  const credited = photoCredit !== null && !blocked;
  const creditWords = credited ? wordsOf(photoCredit) : [];
  const [wordWidths, setWordWidths] = useState<Readonly<Partial<Record<string, number>>>>({});
  // The words are measured once the page has laid the column out.
  const [laidOut, setLaidOut] = useState(false);
  const widest = creditWords.reduce((most, word) => Math.max(most, wordWidths[word] ?? 0), 0);
  return (
    <View testID={testID}>
      <View style={ROW}>
        <View
          style={{ width: Math.max(PHOTO_WIDTH, widest) }}
          onLayout={() => {
            setLaidOut(true);
          }}
        >
          {/* The name is printed beside it. */}
          <Avatar size="xl" image={image} name={name} handle={handle} decorative={true} />
          {credited ? (
            <>
              {laidOut ? (
                <MeasureRuns
                  role="mono"
                  runs={creditWords}
                  onRun={(index, width) => {
                    const word = creditWords[index];
                    if (word === undefined) return;
                    setWordWidths((known) =>
                      known[word] === width ? known : { ...known, [word]: width },
                    );
                  }}
                />
              ) : null}
              <PhotoCredit text={photoCredit} />
            </>
          ) : null}
        </View>
        <View style={WORDS}>
          <View style={NAME_LINE}>
            <View style={NAME}>
              {/* The page's first heading where the app bar shows the handle, not the name. */}
              <Text role="heading" heading={handle === null ? 2 : 1}>
                {name ?? handle ?? ''}
              </Text>
            </View>
            {tag}
          </View>
          {name === null || handle === null ? null : (
            <Text role="mono" tone="secondary">
              {handle}
            </Text>
          )}
          {blocked ? (
            <Text role="body">{notice}</Text>
          ) : (
            <>
              {lines.length === 0 ? null : (
                <View>
                  {lines.map((line) => (
                    <Text key={line} role="caption" tone="secondary">
                      {line}
                    </Text>
                  ))}
                </View>
              )}
              {bio === null ? null : <Text role="caption">{bio}</Text>}
              {link === null ? null : (
                <Link
                  href={link.href}
                  external={true}
                  label={link.domain}
                  testID={`${testID}-link`}
                >
                  <Text role="caption">{link.domain}</Text>
                </Link>
              )}
            </>
          )}
        </View>
      </View>
      {actions.length === 0 ? null : (
        <View style={ACTIONS}>
          {actions.map((action, index) => (
            <Fragment key={action.key ?? index}>{action}</Fragment>
          ))}
        </View>
      )}
    </View>
  );
}
