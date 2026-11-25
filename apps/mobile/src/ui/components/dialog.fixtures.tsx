import { View } from 'react-native';

import { size, space } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import type { DialogProps } from './dialog';
import { Notice } from './notice';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

export const STATES = {
  // The question is the real one, and the body says what will happen.
  confirm: {
    open: true,
    onClose: () => undefined,
    title: 'Make this run public?',
    body: 'Your name will show on the office page, marked Not verified.',
    actions: [
      {
        label: 'Cancel',
        variant: 'quiet',
        onPress: () => undefined,
        testID: 'gallery.dialog-confirm-cancel',
      },
      {
        label: 'Make public',
        variant: 'primary',
        onPress: () => undefined,
        testID: 'gallery.dialog-confirm-make-public',
      },
    ],
    testID: 'gallery.dialog-confirm',
  },
  // A destructive action makes it an alert dialog, and comes last.
  destructive: {
    open: true,
    onClose: () => undefined,
    title: 'Delete this post?',
    body: 'It comes off your profile and out of every feed. This cannot be undone.',
    actions: [
      {
        label: 'Cancel',
        variant: 'quiet',
        onPress: () => undefined,
        testID: 'gallery.dialog-destructive-cancel',
      },
      {
        label: 'Delete',
        variant: 'destructive',
        onPress: () => undefined,
        testID: 'gallery.dialog-destructive-delete',
      },
    ],
    testID: 'gallery.dialog-destructive',
  },
  withChildren: {
    open: true,
    onClose: () => undefined,
    title: 'Stop following Wren County Clerk?',
    body: 'Its deadlines leave your Home feed.',
    children: (
      <Notice kind="warning" text="Filing for this office closes in 3 days, on Fri, Nov 27." />
    ),
    actions: [
      {
        label: 'Keep following',
        variant: 'quiet',
        onPress: () => undefined,
        testID: 'gallery.dialog-with-children-keep',
      },
      {
        label: 'Stop following',
        variant: 'primary',
        onPress: () => undefined,
        testID: 'gallery.dialog-with-children-stop',
      },
    ],
    testID: 'gallery.dialog-with-children',
  },
  // The large frame has no padding and draws its children alone: the pane owns its own.
  large: {
    open: true,
    onClose: () => undefined,
    size: 'lg',
    title: 'Post by Dana Okafor',
    children: (
      <View style={{ minHeight: size.listRowMin * 6, padding: space.x6 }}>
        <Text role="heading" heading={2}>
          Post by Dana Okafor
        </Text>
        <Text role="body" tone="secondary">
          The media pane and the comments pane stand here.
        </Text>
      </View>
    ),
    testID: 'gallery.dialog-large',
  },
  // Neither Esc nor the scrim closes it: one of its buttons must be pressed.
  notDismissible: {
    open: true,
    onClose: () => undefined,
    title: 'Sign out of this phone?',
    body: 'A draft you have not posted stays on this phone.',
    dismissible: false,
    actions: [
      {
        label: 'Stay signed in',
        variant: 'quiet',
        onPress: () => undefined,
        testID: 'gallery.dialog-not-dismissible-stay',
      },
      {
        label: 'Sign out',
        variant: 'primary',
        onPress: () => undefined,
        testID: 'gallery.dialog-not-dismissible-sign-out',
      },
    ],
    testID: 'gallery.dialog-not-dismissible',
  },
  // A title of three lines on a phone: the frame grows and the buttons stay at the end.
  longTitle: {
    open: true,
    onClose: () => undefined,
    title:
      'Leave the Wren County Board of Equalization and Assessment Appeals, District 4, run plan?',
    body: 'The steps you ticked are kept for 30 days.',
    actions: [
      {
        label: 'Stay',
        variant: 'quiet',
        onPress: () => undefined,
        testID: 'gallery.dialog-long-title-stay',
      },
      {
        label: 'Leave',
        variant: 'primary',
        onPress: () => undefined,
        testID: 'gallery.dialog-long-title-leave',
      },
    ],
    testID: 'gallery.dialog-long-title',
  },
} as const satisfies Readonly<Record<string, DialogProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
