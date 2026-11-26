import { goBack } from '@/lib/navigation';

/**
 * The back control of a settings screen: back in the history when there is a screen to go back
 * to, and otherwise to the screen's parent.
 */
export function useSettingsBack(parentHref: string): () => void {
  return () => {
    goBack(parentHref);
  };
}
