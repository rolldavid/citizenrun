import { View } from 'react-native';

import type { InteractionPreviewState } from '@/ui/components/pressable';
import { Text } from '@/ui/components/text';
import type { ColorToken } from '@/ui/tokens';

import type { RightColumnProps } from './right-column';

export const STATES = {
  twoModules: {
    children: (
      <>
        <View>
          <Text role="monoLabel">Deadlines near you</Text>
          <Text role="body">County Treasurer, Wren County. Filing closes in 12 days.</Text>
        </View>
        <View>
          <Text role="monoLabel">People in your races</Text>
          <Text role="body">Carol Wynn holds the office. Dana Okafor is running.</Text>
        </View>
      </>
    ),
  },
} as const satisfies Readonly<Record<string, RightColumnProps>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
