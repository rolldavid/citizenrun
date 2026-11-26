import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { Role } from 'react-native';

/** What a group reads of a key press: the key, and the way to stop what the page would do with it. */
export type KeyGroupKey = { key: string; preventDefault: () => void };

export type KeyGroupProps = {
  onKeyDown: (event: KeyGroupKey) => void;
  role: 'radiogroup' | 'listbox';
  accessibilityLabel?: string;
  testID?: string;
  children: ReactNode;
};

/**
 * The box round the options of a group that is one Tab stop (C-RadioGroup, C-Select). A key pressed
 * on the focused option inside reaches the group, which moves the choice or the focus. A shortcut
 * of the browser or the system is left to it. Phones send no key here: there the platform moves
 * focus between the options by itself.
 */
export function KeyGroup({
  onKeyDown,
  role,
  accessibilityLabel,
  testID,
  children,
}: KeyGroupProps): JSX.Element {
  return (
    <View
      role={role as Role} // React Native's types leave the listbox role out; the web's view takes it
      aria-label={accessibilityLabel}
      testID={testID}
      onKeyDown={(event) => {
        const { key, altKey, ctrlKey, metaKey } = event.nativeEvent;
        // A key held with Alt, Ctrl or the command key is a shortcut of the browser or the system.
        if (altKey || ctrlKey || metaKey) {
          return;
        }
        onKeyDown({
          key,
          preventDefault: () => {
            event.preventDefault();
          },
        });
      }}
    >
      {children}
    </View>
  );
}
