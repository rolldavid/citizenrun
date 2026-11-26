import type { HomeViewModel } from './home.types';

const PLACEHOLDER: HomeViewModel = { kind: 'placeholder' };

/** SCR-home: no data yet, so the screen asks for nothing. */
export function useHomeViewModel(): HomeViewModel {
  return PLACEHOLDER;
}
