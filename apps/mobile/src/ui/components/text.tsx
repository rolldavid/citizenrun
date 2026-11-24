import { fontCovers, typeRoles } from '@citizenrun/shared';
import { createContext, useContext } from 'react';
import type { JSX, ReactNode } from 'react';
import { Text as NativeText } from 'react-native';
import type { TextStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { ToneContext, toneColor } from '@/ui/tone';
import type { ResolvedTone, TextTone } from '@/ui/tone';
import { systemFallback, tabularNums, typography } from '@/ui/typography';
import type { TypeRole } from '@/ui/typography';

export type { TextTone } from '@/ui/tone';

export type TextProps = {
  role: TypeRole;
  /** Default 'primary'; 'inherit' inside another C-Text. */
  tone?: TextTone;
  /** Adds fixed-width digits: for a number that changes in place or sits in a column. */
  tabular?: boolean;
  /** Cut with an ellipsis after this many lines. */
  numberOfLines?: number;
  align?: 'start' | 'center' | 'end';
  /** The heading role, at this level. */
  heading?: 1 | 2 | 3;
  /** Default false; true for source lines and long-form text. */
  selectable?: boolean;
  /** Hidden from screen readers: a decorative repeat. */
  hidden?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  /** Strings, numbers and nested C-Text. */
  children: ReactNode;
};

/** What only the web reads of a heading; React Native's own types leave both out. */
type WebHeadingProps = { 'aria-level'?: 1 | 2 | 3; tabIndex?: -1 };

const TEXT_ALIGN = { start: 'left', center: 'center', end: 'right' } as const;

/** The largest text scale a holder lets the C-Text in it take; null where there is no holder. */
const ScaleLimitContext = createContext<number | null>(null);

/**
 * Stops the C-Text under it from growing past `max` times the size of its role, whatever the text
 * size: for text drawn inside a holder of a fixed size, which cannot grow with it.
 */
export function TextScaleLimit(props: { max: number; children: ReactNode }): JSX.Element {
  return (
    <ScaleLimitContext.Provider value={props.max}>{props.children}</ScaleLimitContext.Provider>
  );
}

/**
 * The largest scale a text takes: the lower of its role's limit and its holder's, and undefined
 * with neither. A holder never makes text smaller than its role, and a phone reads a limit under 1
 * as none.
 */
function largestScale(ofRole: number | undefined, ofHolder: number | null): number | undefined {
  if (ofHolder === null) {
    return ofRole;
  }
  const held = Math.max(1, ofHolder);
  return ofRole === undefined ? held : Math.min(ofRole, held);
}

function times(value: number | undefined, factor: number): number | undefined {
  return value === undefined ? undefined : value * factor;
}

/** The role's style, or the system font's when the role's face cannot draw the whole string. */
function faceStyle(role: TypeRole, children: ReactNode): TextStyle {
  const drawn = typography[role].style;
  if (typeof children !== 'string' || fontCovers(typeRoles[role].face, children)) {
    return drawn;
  }
  // The system font takes the place of the family and its tracking; the role keeps its capitals.
  const fallback = systemFallback(role);
  return drawn.textTransform === undefined
    ? fallback
    : { ...fallback, textTransform: drawn.textTransform };
}

/** A level 1 heading can take focus from code, so a screen reader announces a new screen. */
function headingProps(heading: 1 | 2 | 3 | undefined): WebHeadingProps {
  if (heading === undefined) {
    return {};
  }
  return heading === 1 ? { 'aria-level': heading, tabIndex: -1 } : { 'aria-level': heading };
}

/**
 * C-Text: the only way text reaches the screen. It applies a type role, a tone, the whole-string
 * fallback and the scaling limits. A nested C-Text may change role and inherits the tone.
 */
export function Text({
  role,
  tone,
  tabular = false,
  numberOfLines,
  align,
  heading,
  selectable = false,
  hidden = false,
  accessibilityLabel,
  testID,
  children,
}: TextProps): JSX.Element {
  const theme = useTheme();
  const parentTone = useContext(ToneContext);
  const held = useContext(ScaleLimitContext);
  const asked = tone ?? (parentTone === null ? 'primary' : 'inherit');
  const resolved: ResolvedTone = asked === 'inherit' ? (parentTone ?? 'primary') : asked;

  // A capped role stops growing at the largest scale the big roles take, and text in a holder of a
  // fixed size at the scale its holder sets.
  const largest = largestScale(typography[role].maxFontSizeMultiplier, held);
  const scale = largest === undefined ? theme.textScale : Math.min(theme.textScale, largest);
  const face = faceStyle(role, children);
  const style: TextStyle = {
    ...face,
    fontSize: times(face.fontSize, scale),
    lineHeight: times(face.lineHeight, scale),
    letterSpacing: times(face.letterSpacing, scale),
    color: toneColor(theme.color, resolved),
    ...(tabular ? tabularNums : {}),
    ...(align === undefined ? {} : { textAlign: TEXT_ALIGN[align] }),
  };

  return (
    <ToneContext.Provider value={resolved}>
      <NativeText
        {...headingProps(heading)}
        role={heading === undefined ? undefined : 'heading'}
        style={style}
        numberOfLines={numberOfLines}
        selectable={selectable}
        maxFontSizeMultiplier={largest}
        aria-label={accessibilityLabel}
        aria-hidden={hidden ? true : undefined}
        accessibilityElementsHidden={hidden ? true : undefined}
        importantForAccessibility={hidden ? 'no-hide-descendants' : undefined}
        testID={testID}
      >
        {children}
      </NativeText>
    </ToneContext.Provider>
  );
}
