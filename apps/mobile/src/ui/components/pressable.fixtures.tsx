import type { ColorToken } from '@/ui/tokens';

import type { InteractionPreviewState, PressableProps } from './pressable';
import { Text } from './text';

const line = <Text role="body">Open the office</Text>;

export const STATES = {
  idle: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-idle',
    onPress: () => undefined,
    children: line,
  },
  pressed: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-pressed',
    onPress: () => undefined,
    children: line,
  },
  hovered: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-hovered',
    onPress: () => undefined,
    children: line,
  },
  focused: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-focused',
    onPress: () => undefined,
    children: line,
  },
  disabled: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-disabled',
    disabled: true,
    onPress: () => undefined,
    children: line,
  },
  fill: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-fill',
    feedback: 'fill',
    hover: 'fill',
    onPress: () => undefined,
    children: line,
  },
  fillPressed: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-fill-pressed',
    feedback: 'fill',
    hover: 'fill',
    onPress: () => undefined,
    children: line,
  },
  fillHovered: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-fill-hovered',
    feedback: 'fill',
    hover: 'fill',
    onPress: () => undefined,
    children: line,
  },
  small: {
    role: 'button',
    label: 'Open the office',
    testID: 'gallery.pressable-small',
    drawn: { width: 36, height: 36 },
    onPress: () => undefined,
    children: line,
  },
  link: {
    role: 'link',
    label: 'Open the office',
    testID: 'gallery.pressable-link',
    href: '/dev/gallery',
    children: line,
  },
} as const satisfies Readonly<Record<string, PressableProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  pressed: { pressed: true },
  hovered: { hovered: true },
  focused: { focused: true },
  fillPressed: { pressed: true },
  fillHovered: { hovered: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
