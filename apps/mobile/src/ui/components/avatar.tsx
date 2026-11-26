import { typeRoles } from '@citizenrun/shared';
import { lazy, Suspense, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion, useFade, useReducedMotion } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { radius, size } from '@/ui/tokens';

import { Text, TextScaleLimit } from './text';

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

/**
 * The share of its disc that the initials of the smallest avatar take, the largest share of the
 * five. A disc does not grow with the text size, so its initials grow only up to this share: that
 * far, two capitals stay inside the disc.
 */
const LARGEST_INITIALS_SHARE = typeRoles[INITIALS_ROLE.xs].size / size.avatar.xs;

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
 * The image library's view. It is loaded when the first photo is drawn, so a screen with no photo
 * does not carry it; until it arrives the flat disc shows, as it does while a photo loads.
 */
const PhotoImage = lazy(async () => ({ default: (await import('expo-image')).Image }));

// Typed by what it holds: the same box is the style of a view and of an image.
const COVER = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * The photo of an avatar, filling its disc. It is drawn once it has loaded, by a fade, and a photo
 * that never loads leaves the disc. Nothing is drawn over it, and no blurred preview stands in for
 * it (D-471).
 */
function Photo({ image }: { image: { key: string; url: string } }): JSX.Element {
  const reduced = useReducedMotion();
  // The key of the photo that has loaded: a recycled row that takes another person's photo starts
  // unloaded, with nothing to reset.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const fade = useFade(
    loadedKey === image.key,
    reduced ? motion.duration.fade : motion.duration.photoFade,
  );
  return (
    <Animated.View style={[COVER, fade]}>
      <Suspense fallback={null}>
        <PhotoImage
          source={{ uri: image.url }}
          recyclingKey={image.key}
          contentFit="cover"
          // The disc carries the person's name, or is hidden: the picture itself says nothing more.
          alt=""
          accessibilityLabel=""
          style={COVER}
          onLoad={() => {
            setLoadedKey(image.key);
          }}
        />
      </Suspense>
    </Animated.View>
  );
}

/**
 * C-Avatar: a person, always round. Without a photo it is the initials on a flat disc; a photo
 * fades in over the same bare disc, which is its placeholder. No ring, no status dot, no
 * silhouette, and nothing over the photo.
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
  const role = INITIALS_ROLE[sizeName];
  const person = filled(name) ?? filled(handle);
  const initials = image === null ? avatarInitials(name, handle) : '';
  const disc: ViewStyle = {
    width: side,
    height: side,
    borderRadius: radius.full,
    backgroundColor: theme.color.well,
    alignItems: 'center',
    justifyContent: 'center',
    // A photo is cut to the disc.
    ...(image === null ? {} : { overflow: 'hidden' }),
  };
  const letters =
    image !== null ? (
      <Photo image={image} />
    ) : initials === '' ? null : (
      <TextScaleLimit max={(side * LARGEST_INITIALS_SHARE) / typeRoles[role].size}>
        <Text role={role} tone="primary">
          {initials}
        </Text>
      </TextScaleLimit>
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
