import type { JSX } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import { describedByProps } from './field-shell';
import { useFieldA11y } from './form-field';
import type { FormFieldProps } from './form-field';
import type { InteractionPreviewState } from './pressable';

/** A stand-in for a control of a feature's own: a plain box that takes the field's name. */
function SpecimenControl(): JSX.Element {
  const theme = useTheme();
  const { describedBy, ...named } = useFieldA11y();
  return (
    <View
      {...named}
      {...describedByProps(describedBy)}
      accessible={true}
      role="group"
      style={{
        height: size.input,
        borderRadius: radius.control,
        borderWidth: rule.hairline,
        borderColor: theme.color.rule,
        backgroundColor: theme.color.surface,
      }}
    />
  );
}

const control = <SpecimenControl />;

export const STATES = {
  labelOnly: { label: 'Office you are running for', children: control },
  withHelper: {
    label: 'Office you are running for',
    helper: 'Pick the seat that is on your ballot.',
    children: control,
  },
  // The status line takes the helper's place, behind its icon.
  error: {
    label: 'Office you are running for',
    helper: 'Pick the seat that is on your ballot.',
    status: 'error',
    statusText: 'Pick an office to go on.',
    children: control,
  },
  valid: {
    label: 'Office you are running for',
    helper: 'Pick the seat that is on your ballot.',
    status: 'valid',
    statusText: 'Wren County Clerk is on your ballot.',
    children: control,
  },
  // The label names the control and is not drawn.
  labelHidden: {
    label: 'Office you are running for',
    labelHidden: true,
    helper: 'Pick the seat that is on your ballot.',
    children: control,
  },
} as const satisfies Readonly<Record<string, FormFieldProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
