import { assertNever } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { OfficeViewModel } from '@/features/office/view-models/office.types';
import { useOfficeViewModel } from '@/features/office/view-models/use-office-view-model';
import { goBack } from '@/lib/navigation';
import { head } from '@/platform/head';
import { Screen } from '@/ui/components/screen';
import { Skeleton } from '@/ui/components/skeleton';
import { space } from '@/ui/tokens';

export type OfficeScreenProps = { slug: string };

/** The page's text lines while it loads. */
const LOADING_LINES = 6;

const BLOCKS: ViewStyle = { gap: space.x4 };

/** The office page's frame: its app bar and the hero and text in the shape they will take. */
function OfficeFrame(): JSX.Element {
  return (
    <Screen
      width="page"
      appBar={{
        variant: 'screen',
        title: null,
        onBack: () => {
          goBack('/');
        },
      }}
      testID="office.screen"
    >
      <View style={BLOCKS}>
        <Skeleton shape="canvas" />
        <Skeleton shape="line" lines={LOADING_LINES} />
      </View>
    </Screen>
  );
}

/** SCR-office-slug. Every state draws the page's frame until the page itself is drawn. */
export function OfficeScreenView({ vm }: { vm: OfficeViewModel }): JSX.Element {
  switch (vm.status) {
    case 'loading':
    case 'error':
    case 'offline':
    case 'ready':
      return <OfficeFrame />;
    default:
      return assertNever(vm);
  }
}

export function OfficeScreen({ slug }: OfficeScreenProps): JSX.Element {
  const { t } = useTranslation(['common']);
  const vm = useOfficeViewModel(slug);
  return (
    <>
      {vm.status === 'ready' ? (
        <head.Title>{t('common:documentTitle', { title: vm.data.office.title })}</head.Title>
      ) : null}
      <OfficeScreenView vm={vm} />
    </>
  );
}
