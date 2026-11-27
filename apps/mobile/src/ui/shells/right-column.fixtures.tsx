import { View } from 'react-native';

import { ActionRow } from '@/ui/components/action-row';
import { Meter } from '@/ui/components/meter';
import type { InteractionPreviewState } from '@/ui/components/pressable';
import { Text } from '@/ui/components/text';
import { size, space } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import type { RightColumnProps } from './right-column';

export const STATES = {
  twoModules: {
    children: (
      <>
        <View>
          <Text role="monoLabel">Deadlines near you</Text>
          <Text role="body">
            County Treasurer, Wren County. Filing closes in 12 days, on Fri, Nov 20.
          </Text>
        </View>
        <View>
          <Text role="monoLabel">People in your races</Text>
          <Text role="body">Carol Wynn holds the office. Dana Okafor is running.</Text>
        </View>
      </>
    ),
  },
  // The action card of an office page: the actions, the day count with its date, the two meters.
  officeActionCard: {
    children: (
      <View style={{ width: size.actionCard, gap: space.x4 }}>
        <ActionRow
          kind="office"
          layout="stacked"
          run={{ state: 'hidden' }}
          following={false}
          bookmarked={false}
          onRun={() => undefined}
          onToggleFollow={() => undefined}
          onToggleBookmark={() => undefined}
          itemKey="fixture-office"
          testID="gallery.right-column-office-action-card"
        />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.x2 }}>
          <Text role="numeralTitle">12</Text>
          <Text role="caption" tone="primary">
            closes Fri, Nov 27
          </Text>
        </View>
        <View style={{ gap: space.x3 }}>
          <Meter
            form="page"
            name="Ease"
            score={null}
            phrase={null}
            onPress={() => undefined}
            testID="gallery.right-column-office-action-card-ease"
          />
          <Meter
            form="page"
            name="Impact"
            score={null}
            phrase={null}
            onPress={() => undefined}
            testID="gallery.right-column-office-action-card-impact"
          />
        </View>
      </View>
    ),
  },
} as const satisfies Readonly<Record<string, RightColumnProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
