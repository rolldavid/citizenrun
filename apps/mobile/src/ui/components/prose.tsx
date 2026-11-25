import { assertNever, typeRoles } from '@citizenrun/shared';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, size, space } from '@/ui/tokens';

import { Text } from './text';

export type ProseBlock =
  | { kind: 'title' | 'heading' | 'paragraph'; text: ReactNode }
  | { kind: 'list'; ordered: boolean; items: readonly ReactNode[] };

export type ProseProps = {
  /** The page's title, its section headings, its paragraphs and its lists, in reading order. */
  blocks: readonly ProseBlock[];
  testID?: string;
};

const COLUMN: ViewStyle = { width: '100%', maxWidth: size.longForm, alignItems: 'stretch' };
const AFTER_TITLE: ViewStyle = { marginBottom: space.x6 };
const AFTER_TEXT: ViewStyle = { marginBottom: space.x3 };
const BEFORE_HEADING: ViewStyle = { marginTop: space.x8 };
const ITEM: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start' };
const ITEM_WORDS: ViewStyle = { flex: 1, minWidth: 0 };
const MARK: ViewStyle = { marginRight: space.x2 };
const SQUARE: ViewStyle = {
  width: size.listMarker,
  height: size.listMarker,
  borderRadius: radius.none,
};

/** A space as wide as a figure: it stands where a shorter number has no digit. */
const FIGURE_SPACE = '\u2007';

/** A list of a long-form page: a small square before each item, or its number when ordered. */
function ProseList({
  ordered,
  items,
}: {
  ordered: boolean;
  items: readonly ReactNode[];
}): JSX.Element {
  const theme = useTheme();
  // The square stands at the middle of the item's first line, however large the text is drawn.
  const firstLine = typeRoles.body.lineHeight * theme.textScale;
  const square: ViewStyle = {
    ...SQUARE,
    marginTop: (firstLine - size.listMarker) / 2,
    backgroundColor: theme.color.text,
  };
  // Every number takes the room of the last one, so the items' words stand in one line.
  const digits = String(items.length).length;
  return (
    <View role="list" style={AFTER_TEXT}>
      {items.map((item, index) => (
        // The items of a block never reorder, so an item's place is its key.
        <View key={index} role="listitem" style={ITEM}>
          <View style={MARK}>
            {ordered ? (
              <Text role="body" tabular={true} selectable={true}>
                {`${String(index + 1).padStart(digits, FIGURE_SPACE)}.`}
              </Text>
            ) : (
              <View style={square} />
            )}
          </View>
          <View style={ITEM_WORDS}>
            <Text role="body" selectable={true}>
              {item}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * C-Prose: long-form text inside the app, in one column no wider than a line reads well. A title,
 * section headings, paragraphs and lists, left-aligned and selectable, with nothing drawn and no
 * color. A link is the caller's inline C-Link inside a block's text.
 */
export function Prose({ blocks, testID }: ProseProps): JSX.Element {
  return (
    <View style={COLUMN} testID={testID}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'title':
            return (
              <View key={index} style={AFTER_TITLE}>
                <Text role="title" heading={1} selectable={true}>
                  {block.text}
                </Text>
              </View>
            );
          case 'heading':
            return (
              <View key={index} style={index === 0 ? AFTER_TEXT : [BEFORE_HEADING, AFTER_TEXT]}>
                <Text role="heading" heading={2} selectable={true}>
                  {block.text}
                </Text>
              </View>
            );
          case 'paragraph':
            return (
              <View key={index} style={AFTER_TEXT}>
                <Text role="body" selectable={true}>
                  {block.text}
                </Text>
              </View>
            );
          case 'list':
            return <ProseList key={index} ordered={block.ordered} items={block.items} />;
          default:
            return assertNever(block);
        }
      })}
    </View>
  );
}
