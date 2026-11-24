import type { ColorToken } from '@/ui/tokens';

import type { LinkProps } from './link';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

const words = <Text role="body">Filing rules</Text>;

export const STATES = {
  inline: {
    href: '/dev/gallery',
    label: 'Filing rules',
    testID: 'gallery.link-inline',
    children: words,
  },
  inlineHovered: {
    href: '/dev/gallery',
    label: 'Filing rules',
    testID: 'gallery.link-inline-hovered',
    children: words,
  },
  inlineFocused: {
    href: '/dev/gallery',
    label: 'Filing rules',
    testID: 'gallery.link-inline-focused',
    children: words,
  },
  bare: {
    href: '/dev/gallery',
    variant: 'bare',
    label: 'Filing rules',
    testID: 'gallery.link-bare',
    children: words,
  },
  external: {
    href: 'https://www.example.test/filing',
    external: true,
    label: 'Filing rules',
    testID: 'gallery.link-external',
    children: words,
  },
  // Two addresses the link refuses: it draws the words and opens nothing.
  refusedHttp: {
    href: 'http://example.test',
    external: true,
    label: 'Filing rules',
    testID: 'gallery.link-refused-http',
    children: words,
  },
  refusedProtocolRelative: {
    href: '//example.test/x',
    label: 'Filing rules',
    testID: 'gallery.link-refused-protocol-relative',
    children: words,
  },
} as const satisfies Readonly<Record<string, LinkProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  inlineHovered: { hovered: true },
  inlineFocused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
