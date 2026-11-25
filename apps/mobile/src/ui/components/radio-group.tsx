import { Fragment, useRef } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewInstance, ViewStyle } from 'react-native';

import { space } from '@/ui/tokens';

import { KeyGroup } from './key-group';
import type { KeyGroupKey } from './key-group';
import { Radio } from './radio';
import { Rule } from './rule';
import { Text } from './text';

export type RadioGroupProps = {
  label: string;
  /** Keeps the label as the group's name and drops it from the layout. */
  labelHidden?: boolean;
  /** Null while nothing is chosen. */
  value: string | null;
  options: readonly { value: string; label: string; helper?: string }[];
  onChange: (value: string) => void;
  testID: string;
};

const LABEL: ViewStyle = { marginBottom: space.x2 };

/** The step an arrow key takes through the options: on to the next, or back to the one before. */
function stepOf(key: string): 1 | -1 | null {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return 1;
    case 'ArrowUp':
    case 'ArrowLeft':
      return -1;
    default:
      return null;
  }
}

/**
 * C-RadioGroup: one choice from a short list, as C-Radio rows split by soft rules. The group is one
 * stop in the Tab order: only the chosen option, or the first while nothing is chosen, takes the
 * Tab key, and the arrow keys move the choice and the focus with it, round from each end to the
 * other. Nothing is chosen for the person.
 */
export function RadioGroup({
  label,
  labelHidden = false,
  value,
  options,
  onChange,
  testID,
}: RadioGroupProps): JSX.Element {
  const radios = useRef<(ViewInstance | null)[]>([]);
  const chosen = options.findIndex((option) => option.value === value);
  // The one option in the Tab order.
  const stop = Math.max(chosen, 0);

  const onKeyDown = (event: KeyGroupKey): void => {
    const step = stepOf(event.key);
    if (step === null || options.length === 0) {
      return;
    }
    event.preventDefault();
    const index = (stop + step + options.length) % options.length;
    const next = options[index];
    if (next === undefined) {
      return;
    }
    if (next.value !== value) {
      onChange(next.value);
    }
    radios.current[index]?.focus();
  };

  return (
    <KeyGroup role="radiogroup" accessibilityLabel={label} testID={testID} onKeyDown={onKeyDown}>
      {labelHidden ? null : (
        <View style={LABEL}>
          <Text role="label">{label}</Text>
        </View>
      )}
      {options.map((option, index) => (
        <Fragment key={option.value}>
          {index === 0 ? null : <Rule variant="soft" />}
          <Radio
            ref={(radio) => {
              radios.current[index] = radio;
            }}
            selected={option.value === value}
            label={option.label}
            focusable={index === stop}
            testID={`${testID}-${option.value}`}
            onSelect={() => {
              if (option.value !== value) {
                onChange(option.value);
              }
            }}
            {...(option.helper === undefined ? {} : { helper: option.helper })}
          />
        </Fragment>
      ))}
    </KeyGroup>
  );
}
