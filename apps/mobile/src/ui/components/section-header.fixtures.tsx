import type { ColorToken } from '@/ui/tokens';

import { Button } from './button';
import type { InteractionPreviewState } from './pressable';
import type { SectionHeaderProps } from './section-header';
import { Text } from './text';

export const STATES = {
  plain: { label: 'Your issues' },
  withCount: {
    label: 'Open offices',
    trailing: (
      <Text role="mono" tone="secondary">
        38
      </Text>
    ),
  },
  withAction: {
    label: 'Your issues',
    trailing: (
      <Button
        variant="quiet"
        size="sm"
        label="Edit"
        testID="gallery.section-header-with-action-edit"
        onPress={() => undefined}
      />
    ),
  },
  // A group inside a group: one level down.
  level3: { label: 'Filing dates', level: 3 },
} as const satisfies Readonly<Record<string, SectionHeaderProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
