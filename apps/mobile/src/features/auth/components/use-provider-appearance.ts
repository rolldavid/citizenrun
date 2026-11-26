import type { ComponentProps } from 'react';

import type { SignInViewModel } from '@/features/auth/view-models/sign-in.types';
import { useTheme } from '@/ui/theme';
import { size } from '@/ui/tokens';

/** How a provider draws its own button, read from the view-model's component reference (PC6C-18). */
export type ProviderAppearance = ComponentProps<
  NonNullable<SignInViewModel['appleButton']>
>['appearance'];

/**
 * The look asked of the two provider buttons in a column `columnWidth` wide: each provider's own
 * light or dark button, as wide as the column up to the widest a provider button is drawn.
 */
export function useProviderAppearance(columnWidth: number): ProviderAppearance {
  const dark = useTheme().name === 'dark';
  return {
    appleStyle: dark ? 'white' : 'black',
    googleTheme: dark ? 'filled_black' : 'outline',
    googleShape: 'rectangular',
    googleSize: 'large',
    width: Math.min(columnWidth, size.authButtonMax),
    height: size.target,
  };
}
