import type { JSX, RefObject } from 'react';
import { View } from 'react-native';
import type { HostInstance } from 'react-native';

import { size, space } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import type { PopoverProps } from './popover';
import { Pressable } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

const close = (): void => undefined;

/** No control: whoever draws a state gives it the control that opens it. */
const NO_ANCHOR: RefObject<HostInstance | null> = { current: null };

const PLACES = ['Wren County', 'City of Alder', 'Alder School District', 'State House District 4'];

/** A list of four short rows, as a jump list holds them. `onPick` is called by the row that is pressed. */
function Rows({ state, onPick }: { state: string; onPick: () => void }): JSX.Element {
  return (
    <View>
      {PLACES.map((place, index) => (
        <Pressable
          key={place}
          role="button"
          label={place}
          feedback="fill"
          hover="fill"
          testID={`gallery.popover-${state}-row-${String(index + 1)}`}
          onPress={onPick}
        >
          <View
            style={{
              minHeight: size.listRowCompact,
              paddingHorizontal: space.x4,
              justifyContent: 'center',
            }}
          >
            <Text role="body">{place}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export const STATES = {
  // Under its control, their left edges in line.
  belowStart: {
    open: true,
    onClose: close,
    anchor: NO_ANCHOR,
    placement: 'below-start',
    padded: false,
    label: 'Jump to a place',
    testID: 'gallery.popover-below-start',
    children: <Rows state="below-start" onPick={close} />,
  },
  // Under its control, their right edges in line.
  belowEnd: {
    open: true,
    onClose: close,
    anchor: NO_ANCHOR,
    placement: 'below-end',
    padded: false,
    label: 'Jump to a place',
    testID: 'gallery.popover-below-end',
    children: <Rows state="below-end" onPick={close} />,
  },
  aboveStart: {
    open: true,
    onClose: close,
    anchor: NO_ANCHOR,
    placement: 'above-start',
    padded: false,
    label: 'Jump to a place',
    testID: 'gallery.popover-above-start',
    children: <Rows state="above-start" onPick={close} />,
  },
  aboveEnd: {
    open: true,
    onClose: close,
    anchor: NO_ANCHOR,
    placement: 'above-end',
    padded: false,
    label: 'Jump to a place',
    testID: 'gallery.popover-above-end',
    children: <Rows state="above-end" onPick={close} />,
  },
  // Beside its control, level with its top.
  end: {
    open: true,
    onClose: close,
    anchor: NO_ANCHOR,
    placement: 'end',
    padded: false,
    label: 'Jump to a place',
    testID: 'gallery.popover-end',
    children: <Rows state="end" onPick={close} />,
  },
  // Anything but a list of rows keeps the popover's own padding.
  padded: {
    open: true,
    onClose: close,
    anchor: NO_ANCHOR,
    label: 'Open this office in the app',
    testID: 'gallery.popover-padded',
    children: (
      <Text role="body">
        Point your phone’s camera at the code to open Wren County Clerk in the app.
      </Text>
    ),
  },
  // A control narrower than the popover may be: the popover keeps its least width.
  narrowAnchor: {
    open: true,
    onClose: close,
    anchor: NO_ANCHOR,
    padded: false,
    label: 'Jump to a place',
    testID: 'gallery.popover-narrow-anchor',
    children: <Rows state="narrow-anchor" onPick={close} />,
  },
} as const satisfies Readonly<Record<string, PopoverProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
