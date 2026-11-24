import { View } from 'react-native';

import { space } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import { Button } from './button';
import type { InteractionPreviewState } from './pressable';
import type { SheetProps } from './sheet';
import { Text } from './text';

export const STATES = {
  open: {
    open: true,
    onClose: () => undefined,
    title: 'Not interested?',
    children: (
      <View style={{ gap: space.x1 }}>
        <Text role="body">We will show fewer school board cards.</Text>
        <Text role="body" tone="secondary">
          You can change this in Settings.
        </Text>
      </View>
    ),
    footer: (
      <Button
        variant="primary"
        label="Show fewer"
        testID="gallery.sheet-open-show-fewer"
        onPress={() => undefined}
      />
    ),
    testID: 'gallery.sheet-open',
  },
  // No title: the first child is the heading.
  openNoTitle: {
    open: true,
    onClose: () => undefined,
    children: (
      <View style={{ gap: space.x1 }}>
        <Text role="heading" heading={2}>
          Sources
        </Text>
        <Text role="body" tone="secondary">
          Pay and filing dates come from the Wren County Clerk.
        </Text>
      </View>
    ),
    testID: 'gallery.sheet-open-no-title',
  },
  withFooter: {
    open: true,
    onClose: () => undefined,
    title: 'Sort offices',
    children: <Text role="body">Soonest filing deadline first.</Text>,
    footer: (
      <View style={{ flexDirection: 'row', gap: space.x2 }}>
        <Button
          variant="primary"
          label="Show 38 offices"
          testID="gallery.sheet-with-footer-apply"
          onPress={() => undefined}
        />
        <Button
          variant="quiet"
          label="Clear"
          testID="gallery.sheet-with-footer-clear"
          onPress={() => undefined}
        />
      </View>
    ),
    testID: 'gallery.sheet-with-footer',
  },
  // It asks a question that must be answered: only its button closes it.
  notDismissible: {
    open: true,
    onClose: () => undefined,
    title: 'Use AI to tidy your bio?',
    dismissible: false,
    children: (
      <Text role="body">Your bio is sent to the AI service once, and is not kept there.</Text>
    ),
    footer: (
      <Button
        variant="primary"
        label="Allow"
        testID="gallery.sheet-not-dismissible-allow"
        onPress={() => undefined}
      />
    ),
    testID: 'gallery.sheet-not-dismissible',
  },
  // Rests at half the screen and can be pulled to the whole of it.
  half: {
    open: true,
    onClose: () => undefined,
    title: 'Filters',
    detents: ['half', 'full'],
    children: (
      <View style={{ gap: space.x1 }}>
        <Text role="body">Offices that fit around a job.</Text>
        <Text role="body" tone="secondary">
          Wren County, Alder and East Tilden.
        </Text>
      </View>
    ),
    testID: 'gallery.sheet-half',
  },
} as const satisfies Readonly<Record<string, SheetProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
