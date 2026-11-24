import type { ColorToken } from '@/ui/tokens';

import { IconButton } from './icon-button';
import type { InteractionPreviewState } from './pressable';
import type { TooltipProps } from './tooltip';

export const STATES = {
  // The bubble shows under a pointer or on keyboard focus: at rest the specimen is the control alone.
  onIconButton: {
    text: 'Settings',
    children: (
      <IconButton
        icon="settings"
        label="Settings"
        testID="gallery.tooltip-target"
        onPress={() => undefined}
      />
    ),
  },
} as const satisfies Readonly<Record<string, TooltipProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
