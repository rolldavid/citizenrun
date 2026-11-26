import { parseSafeUrl, SOURCE_URL_MAX } from '@citizenrun/shared';
import { Link as RouterLink } from 'expo-router';
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as NativeText, View } from 'react-native';
import type { TextStyle } from 'react-native';

import { assertRouterPath } from '@/lib/router-path';
import { focusRingStyle } from '@/ui/focus';
import { useTheme } from '@/ui/theme';
import { radius, rule } from '@/ui/tokens';

import { Pressable, useInteractionPreview } from './pressable';
import { Text, useInTextRun } from './text';

export type LinkProps = {
  /** An in-app path, or with `external` an outside https:// URL. */
  href: string;
  /** Default false. True: the link opens outside the app, on the web in a new tab. */
  external?: boolean;
  /** Default 'inline': underlined. 'bare': no underline, for wrapping a row or a card. */
  variant?: 'inline' | 'bare';
  /** The accessible name; without it the name is the link's own text. */
  label?: string;
  testID: string;
  children: ReactNode;
};

/** True for a path inside the app: one leading slash, not followed by a second slash or a backslash. */
function isInternalPath(href: string): boolean {
  if (!href.startsWith('/')) {
    return false;
  }
  const second = href.charAt(1);
  return second !== '/' && second !== '\\';
}

/** The address the link opens, or null for one it refuses. */
function acceptedHref(href: string, external: boolean): string | null {
  if (external) {
    return parseSafeUrl(href, SOURCE_URL_MAX)?.url ?? null;
  }
  return isInternalPath(href) ? href : null;
}

/** How far under the baseline the underline of a link in a line of text sits: no token holds it. */
const UNDERLINE_OFFSET = '0.18em';

/**
 * What only the web reads of a link in a line of text: the weight of its underline, its distance
 * from the baseline, and that a space the line breaks at is not underlined. A phone draws the
 * underline of its own text engine, at the weight and the distance the font gives.
 */
type WebRunStyle = {
  textDecorationThickness: number;
  textUnderlineOffset: string;
  whiteSpace: 'normal';
};

/**
 * The anchor attributes of an outside link in a line of text, as C-Pressable sets them on its own
 * target: the router's link takes them, and the web's text reads them from `hrefAttrs`.
 */
const OUTSIDE = { target: '_blank', rel: 'noopener noreferrer nofollow' } as const;
const OUTSIDE_ANCHOR = { hrefAttrs: OUTSIDE };

type RunLinkProps = {
  /** An address the link has accepted. */
  href: string;
  external: boolean;
  /** The accessible name; empty where the words are the name. */
  name: string;
  testID: string;
  children: ReactNode;
};

/**
 * The underlined link inside a line of text: text in that line, an anchor on the web, with the
 * underline as its text decoration. It wraps with the sentence and holds no box.
 */
function RunLink({ href, external, name, testID, children }: RunLinkProps): JSX.Element {
  const theme = useTheme();
  const preview = useInteractionPreview();
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const focused = isFocused || preview.focused === true;
  const thick = isHovered || preview.hovered === true || focused;
  const style: TextStyle & WebRunStyle = {
    textDecorationLine: 'underline',
    textDecorationColor: theme.color.linkText,
    textDecorationThickness: thick ? rule.underlineHover : rule.underline,
    textUnderlineOffset: UNDERLINE_OFFSET,
    whiteSpace: 'normal',
    ...(focused ? focusRingStyle(theme, radius.none) : {}),
  };
  // The web's text reports a pointer and its focus; a phone's text has neither and reads none of these.
  const pointerAndFocus = {
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
  };
  assertRouterPath(href); // the router's generated route types cannot name a path that arrives as a prop
  return (
    <RouterLink href={href} asChild {...(external ? OUTSIDE : {})}>
      <NativeText
        {...(external ? OUTSIDE_ANCHOR : {})}
        aria-label={name === '' ? undefined : name}
        testID={testID}
        style={style}
        {...pointerAndFocus}
      >
        {children}
      </NativeText>
    </RouterLink>
  );
}

/**
 * C-Link: a link in running text, or a row that navigates; the web gets a real anchor. A refused
 * address draws the children as plain content and opens nothing. The underline is never a color
 * other than linkText. Inside a C-Text the underlined link is text in that line; anywhere else it
 * is a box as wide as its words.
 */
export function Link({
  href,
  external = false,
  variant = 'inline',
  label,
  testID,
  children,
}: LinkProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const inRun = useInTextRun() && variant === 'inline';
  const words =
    typeof children === 'string' || typeof children === 'number' ? String(children) : null;
  // In a line of text, plain words take the type of that line.
  const content = words === null ? children : inRun ? words : <Text role="body">{words}</Text>;
  const accepted = acceptedHref(href, external);

  if (accepted === null) {
    return inRun ? (
      <NativeText testID={testID}>{content}</NativeText>
    ) : (
      <View testID={testID}>{content}</View>
    );
  }

  // Without a name of its own the anchor takes its name from its text.
  const name = label ?? words;
  const accessibleName =
    name === null ? '' : external ? t('ui.link.external', { label: name }) : name;

  if (inRun) {
    return (
      <RunLink href={accepted} external={external} name={accessibleName} testID={testID}>
        {content}
      </RunLink>
    );
  }

  const anchor = (
    <Pressable
      role="link"
      href={accepted}
      external={external}
      feedback="none"
      hover="none"
      radius={radius.none}
      label={accessibleName}
      testID={testID}
    >
      {variant === 'bare'
        ? content
        : ({ hovered, focused }) => {
            const thick = hovered || focused;
            return (
              <View
                style={{
                  alignSelf: 'flex-start',
                  borderBottomWidth: thick ? rule.underlineHover : rule.underline,
                  borderBottomColor: theme.color.linkText,
                  // The room the thicker underline takes, so nothing moves when it thickens.
                  marginBottom: thick ? 0 : rule.underlineHover - rule.underline,
                }}
              >
                {content}
              </View>
            );
          }}
    </Pressable>
  );

  // An underlined link is as wide as its words, and so are its press target and its focus ring.
  // A bare link takes the width its container gives it: it wraps a row or a card.
  return variant === 'bare' ? anchor : <View style={{ alignItems: 'flex-start' }}>{anchor}</View>;
}
