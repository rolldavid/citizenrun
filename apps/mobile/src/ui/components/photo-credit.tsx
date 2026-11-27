import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { space } from '@/ui/tokens';

import { Text } from './text';

export type PhotoCreditProps = {
  /** The author, the licence, and "cropped" when the photo was: one translated string. */
  text: string;
};

const UNDER_PHOTO: ViewStyle = { marginTop: space.x1 };

/** C-PhotoCredit: the credit under a photo on a person's page (D-333). Never over the photo. */
export function PhotoCredit({ text }: PhotoCreditProps): JSX.Element {
  return (
    <View style={UNDER_PHOTO}>
      <Text role="mono" tone="secondary" selectable={true}>
        {text}
      </Text>
    </View>
  );
}
