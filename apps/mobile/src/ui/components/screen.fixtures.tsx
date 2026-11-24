import type { JSX } from 'react';
import { View } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { space } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import { Button } from './button';
import type { InteractionPreviewState } from './pressable';
import { Rule } from './rule';
import type { ScreenProps } from './screen';
import { Text } from './text';

/** A few paragraphs, as a screen's content. */
function paragraphs(): JSX.Element {
  return (
    <View style={{ gap: space.x3, paddingVertical: space.x4 }}>
      <Text role="body">
        Wren County elects a clerk, a sheriff, an assessor and five commissioners.
      </Text>
      <Text role="body">
        The clerk keeps county records and runs county elections. The term is four years.
      </Text>
      <Text role="body" tone="secondary">
        Filing opens on January 12 and closes on March 6.
      </Text>
    </View>
  );
}

/** A stand-in for the bar a flow pins to the bottom: one button at the gutter, under a rule. */
function Footer(): JSX.Element {
  const { gutter } = useBreakpoint();
  return (
    <View>
      <Rule variant="strong" />
      <View style={{ paddingVertical: space.x3, paddingHorizontal: gutter }}>
        <Button
          variant="primary"
          label="Save"
          fullWidth
          onPress={() => undefined}
          testID="gallery.screen-save"
        />
      </View>
    </View>
  );
}

const SCREEN_BAR = { variant: 'screen', title: 'Wren County', onBack: () => undefined } as const;

export const STATES = {
  screenAppBar: {
    appBar: SCREEN_BAR,
    testID: 'gallery.screen-screen-app-bar',
    children: paragraphs(),
  },
  // The bar of Home, drawn at compact only: it scrolls away with the page.
  homeAppBar: {
    appBar: { variant: 'home', unreadMessages: 0, onOpenMessages: () => undefined },
    testID: 'gallery.screen-home-app-bar',
    children: paragraphs(),
  },
  noAppBar: { appBar: null, testID: 'gallery.screen-no-app-bar', children: paragraphs() },
  offline: {
    appBar: SCREEN_BAR,
    offline: true,
    testID: 'gallery.screen-offline',
    children: paragraphs(),
  },
  offlineWithRetry: {
    appBar: SCREEN_BAR,
    offline: true,
    onRetry: () => undefined,
    testID: 'gallery.screen-offline-with-retry',
    children: paragraphs(),
  },
  withFooter: {
    appBar: SCREEN_BAR,
    footer: <Footer />,
    testID: 'gallery.screen-with-footer',
    children: paragraphs(),
  },
  // The right column stands beside the feed column at expanded, and nowhere else.
  withAside: {
    appBar: null,
    width: 'feed',
    aside: <Text role="body">Deadlines near you</Text>,
    testID: 'gallery.screen-with-aside',
    children: paragraphs(),
  },
  widthLongForm: {
    appBar: SCREEN_BAR,
    width: 'longForm',
    testID: 'gallery.screen-width-long-form',
    children: paragraphs(),
  },
  widthFull: {
    appBar: SCREEN_BAR,
    width: 'full',
    testID: 'gallery.screen-width-full',
    children: paragraphs(),
  },
} as const satisfies Readonly<Record<string, ScreenProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
