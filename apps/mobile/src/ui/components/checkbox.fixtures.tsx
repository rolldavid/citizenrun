import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { ColorToken } from '@/ui/tokens';

import type { CheckboxProps } from './checkbox';
import { Link } from './link';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

const change = (): void => undefined;

// The words and the link of a sentence stand on one baseline and wrap as a line does.
const SENTENCE: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' };

/** A consent line: a sentence that ends in a link to the document it names. */
const consent = (
  <View style={SENTENCE}>
    <Text role="body">I agree to the </Text>
    <Link
      href="https://example.test/terms"
      external={true}
      testID="gallery.checkbox-with-link-terms"
    >
      terms of use
    </Link>
  </View>
);

const REMINDER = 'Remind me before filing closes';

export const STATES = {
  unchecked: {
    checked: false,
    onChange: change,
    label: REMINDER,
    labelText: REMINDER,
    testID: 'gallery.checkbox-unchecked',
  },
  checked: {
    checked: true,
    onChange: change,
    label: REMINDER,
    labelText: REMINDER,
    testID: 'gallery.checkbox-checked',
  },
  // A row of a picker: the name first, the box at the row's right end.
  positionEnd: {
    checked: true,
    onChange: change,
    label: 'Wren County Clerk',
    labelText: 'Wren County Clerk',
    position: 'end',
    testID: 'gallery.checkbox-position-end',
  },
  disabled: {
    checked: false,
    onChange: change,
    label: REMINDER,
    labelText: REMINDER,
    disabled: true,
    testID: 'gallery.checkbox-disabled',
  },
  disabledChecked: {
    checked: true,
    onChange: change,
    label: REMINDER,
    labelText: REMINDER,
    disabled: true,
    testID: 'gallery.checkbox-disabled-checked',
  },
  // The link is pressed by itself; the box and the room the words leave toggle the box.
  withLink: {
    checked: false,
    onChange: change,
    label: consent,
    labelText: 'I agree to the terms of use',
    testID: 'gallery.checkbox-with-link',
  },
  longLabel: {
    checked: false,
    onChange: change,
    label:
      'Email me when the Wren County Clerk posts a new filing date, a change to the filing fee or a new form for this office',
    labelText:
      'Email me when the Wren County Clerk posts a new filing date, a change to the filing fee or a new form for this office',
    testID: 'gallery.checkbox-long-label',
  },
  hovered: {
    checked: false,
    onChange: change,
    label: REMINDER,
    labelText: REMINDER,
    testID: 'gallery.checkbox-hovered',
  },
  pressed: {
    checked: false,
    onChange: change,
    label: REMINDER,
    labelText: REMINDER,
    testID: 'gallery.checkbox-pressed',
  },
  focused: {
    checked: false,
    onChange: change,
    label: REMINDER,
    labelText: REMINDER,
    testID: 'gallery.checkbox-focused',
  },
} as const satisfies Readonly<Record<string, CheckboxProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {
  hovered: { hovered: true },
  pressed: { pressed: true },
  focused: { focused: true },
};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
