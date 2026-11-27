import { assertNever } from '@citizenrun/shared';
import type { TFunction } from 'i18next';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as NativeText, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { ConfidencePips, useConfidenceWords } from './confidence-badge';
import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

export type SourceLinkProps = {
  /** The confidence of the source, said before its text; null draws no mark. */
  confidence: 'high' | 'medium' | 'low' | null;
  /** The source line, already translated: the host and the date checked on a page. */
  text: string;
  /** Opens the sources sheet. */
  onPress: () => void;
  testID: string;
};

type Confidence = NonNullable<SourceLinkProps['confidence']>;

// The whole row is the target, at least as high as the smallest one.
const ROW: ViewStyle = {
  minHeight: size.target,
  justifyContent: 'center',
  paddingVertical: space.x2,
};
// The words take the row's width and the chevron stands at its end.
const LINE: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };
const WORDS: ViewStyle = { flex: 1, minWidth: 0 };
// The pips stand in the line of text, with the badge's room after them.
const MARK: ViewStyle = { paddingRight: space.x2 };

/**
 * What only the web reads of the underline: its weight, its distance from the baseline, and that a
 * space the line breaks at is not underlined. A phone draws the underline of its own text engine.
 */
type WebRunStyle = { textDecorationThickness: number; textUnderlineOffset: string };
/** How far under the baseline the underline sits: no token holds it. */
const UNDERLINE_OFFSET = '0.18em';

/** The confidence in words, then the source line: one catalog string, printed and read. */
function sayWithConfidence(confidence: Confidence, text: string, t: TFunction): string {
  switch (confidence) {
    case 'high':
      return t('ui.sourceLink.high', { text });
    case 'medium':
      return t('ui.sourceLink.medium', { text });
    case 'low':
      return t('ui.sourceLink.low', { text });
    default:
      return assertNever(confidence);
  }
}

/**
 * What the row says, printed as read: the source line alone with no confidence, or when the line
 * already begins with the confidence's words (a card's "Medium confidence · Sources"); otherwise
 * the confidence in words, then the line.
 */
function useWords(confidence: SourceLinkProps['confidence'], text: string): string {
  const { t } = useTranslation('common');
  const words = useConfidenceWords(confidence ?? 'medium');
  if (confidence === null || text.startsWith(words)) {
    return text;
  }
  return sayWithConfidence(confidence, text, t);
}

/**
 * C-SourceLink: the source of a figure, one tap from it. One row that is one target: the
 * confidence mark, the source line in grey mono, and a chevron. The mark and the words are one line
 * of text, so the line wraps where a word ends and never cuts the date; the words are underlined
 * under a pointer and on keyboard focus. It only calls `onPress`; it opens no address itself.
 */
export function SourceLink({ confidence, text, onPress, testID }: SourceLinkProps): JSX.Element {
  const theme = useTheme();
  const words = useWords(confidence, text);
  const underline: TextStyle & WebRunStyle = {
    textDecorationLine: 'underline',
    textDecorationColor: theme.color.textSecondary,
    textDecorationThickness: rule.underline,
    textUnderlineOffset: UNDERLINE_OFFSET,
  };
  return (
    <Pressable
      role="button"
      label={words}
      feedback="fill"
      hover="fill"
      radius={radius.none}
      testID={testID}
      onPress={onPress}
    >
      {({ hovered, focused }) => (
        <View style={ROW}>
          <View style={LINE}>
            <View style={WORDS}>
              {/* No line limit: a source line never loses the date at its end. */}
              <Text role="mono" tone="secondary" selectable={true}>
                {confidence === null ? null : (
                  <View style={MARK}>
                    <ConfidencePips level={confidence} />
                  </View>
                )}
                <NativeText style={hovered || focused ? underline : null}>{words}</NativeText>
              </Text>
            </View>
            <Icon name="chevronRight" size="small" tone="secondary" />
          </View>
        </View>
      )}
    </Pressable>
  );
}
