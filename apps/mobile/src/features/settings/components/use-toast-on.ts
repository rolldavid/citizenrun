import { useEffect, useRef } from 'react';

import { showToast } from '@/ui/components/toast';

/**
 * Shows one toast each time `condition` turns from false to true: an outcome the view-model only
 * signals, such as a save that went through or a switch that could not be set. A screen that
 * opens with the condition already true shows it once.
 */
export function useToastOn(
  condition: boolean,
  input: { kind: 'success' | 'error'; text: string },
): void {
  const was = useRef(false);
  // The words of the latest render, so a toast never says what an earlier render held.
  const latest = useRef(input);

  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    if (condition && !was.current) {
      showToast(latest.current);
    }
    was.current = condition;
  }, [condition]);
}
