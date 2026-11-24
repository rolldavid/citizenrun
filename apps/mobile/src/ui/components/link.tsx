import { parseSafeUrl, SOURCE_URL_MAX } from '@citizenrun/shared';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule } from '@/ui/tokens';

import { Pressable } from './pressable';
import { Text } from './text';

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

/**
 * C-Link: a link in running text, or a row that navigates; the web gets a real anchor. A refused
 * address draws the children as plain content and opens nothing. The underline is never a color
 * other than linkText.
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
  const words =
    typeof children === 'string' || typeof children === 'number' ? String(children) : null;
  const content = words === null ? children : <Text role="body">{words}</Text>;
  const accepted = acceptedHref(href, external);

  if (accepted === null) {
    return <View testID={testID}>{content}</View>;
  }

  // Without a name of its own the anchor takes its name from its text.
  const name = label ?? words;
  const accessibleName =
    name === null ? '' : external ? t('ui.link.external', { label: name }) : name;

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
