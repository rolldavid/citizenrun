import { Fragment, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as NativeText } from 'react-native';
import type { KeyDownEvent, TextInstance, TextStyle } from 'react-native';

import { focusRingStyle } from '@/ui/focus';
import { useTheme } from '@/ui/theme';
import { radius, rule } from '@/ui/tokens';

import { useInteractionPreview } from './pressable';
import { Text } from './text';

export type DealLineProps = {
  /** The sentences of the deal, in order; each is whole and ends with its full stop. */
  parts: readonly {
    id: 'pay' | 'hours' | 'impact' | 'votes';
    text: string;
    /** The figure inside `text` that is underlined when the part opens its inputs. */
    figure?: string;
    /** Opens the inputs of the part's figure. */
    onPress?: () => void;
  }[];
  testID: string;
};

type Part = DealLineProps['parts'][number];

/** How far under the baseline the underline of a figure sits: no token holds it. */
const UNDERLINE_OFFSET = '0.18em';

/**
 * What only the web reads of an underlined figure: the weight of its underline, its distance from
 * the baseline, and that a space the line breaks at is not underlined. A phone draws the underline
 * of its own text engine, at the weight and the distance the font gives.
 */
type WebRunStyle = {
  textDecorationThickness: number;
  textUnderlineOffset: string;
  whiteSpace: 'normal';
};

/** True for a host that takes attributes: the web's text has the method, a phone's has not. */
function takesAttributes(
  target: unknown,
): target is { setAttribute: (name: string, value: string) => void } {
  return (
    typeof target === 'object' &&
    target !== null &&
    'setAttribute' in target &&
    typeof target.setAttribute === 'function'
  );
}

/**
 * Writes the button role on the text itself. The web draws a text that is given the role as a
 * button element, which is a box of its own and does not wrap with its sentence; with the role
 * written here the part stays text in its line.
 */
function sayButton(target: TextInstance | null): void {
  if (takesAttributes(target)) {
    target.setAttribute('role', 'button');
  }
}

/** The part's text around the first occurrence of its figure; null when there is none to split out. */
function splitAtFigure(part: Part): { before: string; figure: string; after: string } | null {
  const figure = part.figure;
  if (figure === undefined || figure === '') {
    return null;
  }
  const at = part.text.indexOf(figure);
  if (at < 0) {
    return null;
  }
  return { before: part.text.slice(0, at), figure, after: part.text.slice(at + figure.length) };
}

type PressablePartProps = { part: Part; onPress: () => void; testID: string };

/**
 * A sentence of the deal that opens its figure's inputs: text in the paragraph's line, a button to
 * a screen reader and to the keyboard, with the figure underlined.
 */
function PressablePart({ part, onPress, testID }: PressablePartProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const preview = useInteractionPreview();
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const focused = isFocused || preview.focused === true;
  const thick = isHovered || preview.hovered === true || focused;
  const split = splitAtFigure(part);
  const underline: TextStyle & WebRunStyle = {
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
    textDecorationColor: theme.color.text,
    textDecorationThickness: thick ? rule.underlineHover : rule.underline,
    textUnderlineOffset: UNDERLINE_OFFSET,
    whiteSpace: 'normal',
  };
  // The web's text takes focus, reports a pointer and hears keys; a phone's text reads none of these.
  const keyboardAndPointer = {
    tabIndex: 0,
    onMouseEnter: (): void => {
      setHovered(true);
    },
    onMouseLeave: (): void => {
      setHovered(false);
    },
    onFocus: (): void => {
      setFocused(true);
    },
    onBlur: (): void => {
      setFocused(false);
    },
    // A text is no button element, so Enter and Space press it here.
    onKeyDown: (event: KeyDownEvent): void => {
      const { key, repeat } = event.nativeEvent;
      if (repeat === true || (key !== 'Enter' && key !== ' ')) {
        return;
      }
      event.preventDefault();
      onPress();
    },
  };
  return (
    <NativeText
      ref={sayButton}
      accessibilityHint={t('ui.deal.opensInputs')}
      testID={testID}
      style={focused ? focusRingStyle(theme, radius.none) : undefined}
      onPress={onPress}
      {...keyboardAndPointer}
    >
      {split === null ? (
        <Text role="title">{part.text}</Text>
      ) : (
        <>
          {split.before === '' ? null : <Text role="title">{split.before}</Text>}
          <NativeText style={underline}>
            <Text role="title">{split.figure}</Text>
          </NativeText>
          {split.after === '' ? null : <Text role="title">{split.after}</Text>}
        </>
      )}
    </NativeText>
  );
}

/**
 * C-DealLine: the deal of an office in one paragraph, the sentences in order with the catalog's
 * separator between them. A sentence that opens its figure's inputs is a button in the line, its
 * figure underlined in the text color. Nothing in the paragraph is bold and nothing is colored.
 */
export function DealLine({ parts, testID }: DealLineProps): JSX.Element {
  // The separator is the cards catalog's, where the sentences it joins are written.
  const { t } = useTranslation(['common', 'cards']);
  const separator = t('cards:deal.separator');
  return (
    <Text role="title" testID={testID}>
      {parts.map((part, index) => (
        <Fragment key={part.id}>
          {index === 0 ? null : separator}
          {part.onPress === undefined ? (
            <Text role="title">{part.text}</Text>
          ) : (
            <PressablePart part={part} onPress={part.onPress} testID={`${testID}-${part.id}`} />
          )}
        </Fragment>
      ))}
    </Text>
  );
}
