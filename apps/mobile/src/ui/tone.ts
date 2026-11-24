import { assertNever } from '@citizenrun/shared';
import { createContext } from 'react';
import type { Context } from 'react';

import type { ThemeColors } from './tokens';

export type TextTone =
  | 'primary'
  | 'secondary'
  | 'inverse'
  | 'inverseSecondary'
  | 'onAccent'
  | 'onHighlight'
  | 'danger'
  | 'success'
  | 'disabled'
  | 'onMedia'
  | 'inherit';

export type ResolvedTone = Exclude<TextTone, 'inherit'>;

/** The token each tone draws in. */
export function toneColor(colors: ThemeColors, tone: ResolvedTone): string {
  switch (tone) {
    case 'primary':
      return colors.text;
    case 'secondary':
      return colors.textSecondary;
    case 'inverse':
      return colors.inverseText;
    case 'inverseSecondary':
      return colors.inverseTextSecondary;
    case 'onAccent':
      return colors.onAccent;
    case 'onHighlight':
      return colors.onHighlight;
    case 'danger':
      return colors.danger;
    case 'success':
      return colors.success;
    case 'disabled':
      return colors.disabledText;
    case 'onMedia':
      return colors.onMediaControl;
    default:
      return assertNever(tone);
  }
}

/** The resolved tone of the nearest C-Text; null outside any C-Text. */
export const ToneContext: Context<ResolvedTone | null> = createContext<ResolvedTone | null>(null);
