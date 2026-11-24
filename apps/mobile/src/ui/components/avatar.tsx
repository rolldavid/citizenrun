import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, size } from '@/ui/tokens';

import { Text } from './text';

export type AvatarProps = {
  /** xs: a reply, a stack. sm: rows and headers. md: a shared-person card. lg and xl: profiles. */
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** The person's photo; null draws the initials. */
  image: { key: string; url: string } | null;
  name: string | null;
  handle: string | null;
  /** Default false. True where the name is printed beside it: hidden from screen readers. */
  decorative?: boolean;
  testID?: string;
};

const INITIALS_ROLE = {
  xs: 'initialsSm',
  sm: 'initialsSm',
  md: 'initialsMd',
  lg: 'initialsMd',
  xl: 'initialsLg',
} as const;

/** The first character of a string, whole even where it takes two code units. */
function firstCharacter(text: string): string {
  return Array.from(text)[0] ?? '';
}

/** The text, trimmed; null when nothing is left. */
function filled(text: string | null): string | null {
  const trimmed = text === null ? '' : text.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The initials of a person (PC6A-26): the first letter of the first word of the name and, for a
 * name of two words or more, the first letter of its last word; with no name, the first character
 * of the handle; with neither, nothing. The type role draws the capitals.
 */
export function avatarInitials(name: string | null, handle: string | null): string {
  const words = (name ?? '').trim().split(/\s+/);
  const first = words[0] ?? '';
  if (first !== '') {
    const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
    return firstCharacter(first) + firstCharacter(last);
  }
  return firstCharacter(handle ?? '');
}

/**
 * C-Avatar: a person, always round. Without a photo it is the initials on a flat disc; a photo
 * keeps the bare disc as its placeholder. No ring, no status dot, no silhouette.
 */
export function Avatar({
  size: sizeName,
  image,
  name,
  handle,
  decorative = false,
  testID,
}: AvatarProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const side = size.avatar[sizeName];
  const person = filled(name) ?? filled(handle);
  const initials = image === null ? avatarInitials(name, handle) : '';
  const disc: ViewStyle = {
    width: side,
    height: side,
    borderRadius: radius.full,
    backgroundColor: theme.color.well,
    alignItems: 'center',
    justifyContent: 'center',
  };
  const letters =
    initials === '' ? null : (
      <Text role={INITIALS_ROLE[sizeName]} tone="primary">
        {initials}
      </Text>
    );

  if (decorative || person === null) {
    return (
      <View
        style={disc}
        testID={testID}
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {letters}
      </View>
    );
  }
  // `accessible` makes the disc one element for the phone's screen reader.
  return (
    <View
      style={disc}
      testID={testID}
      accessible={true}
      role="img"
      aria-label={t('ui.avatar.label', { name: person })}
    >
      {letters}
    </View>
  );
}
