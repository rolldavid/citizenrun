import { createElement, useSyncExternalStore } from 'react';
import type { ComponentType, ReactElement } from 'react';

import type { ProviderButtonAppearance } from '@/platform/auth';

/** What the screen supplies to a provider button (PC6C-18, D-547). */
export type ScreenButtonProps = {
  appearance: ProviderButtonAppearance;
  testID: string;
  accessibilityLabel: string;
};

export type BoundButton<P extends ScreenButtonProps> = {
  Button: ComponentType<ScreenButtonProps>;
  bind: (binding: Omit<P, keyof ScreenButtonProps>) => void;
};

/** A component reference whose own props come from a small store, so a new binding re-renders it in place. */
export function createBoundButton<P extends ScreenButtonProps>(
  Component: ComponentType<P>,
  initial?: Omit<P, keyof ScreenButtonProps>,
): BoundButton<P> {
  let binding: Omit<P, keyof ScreenButtonProps> | null = initial ?? null;
  const listeners = new Set<() => void>();

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const read = (): Omit<P, keyof ScreenButtonProps> | null => binding;

  function Button(props: ScreenButtonProps): ReactElement | null {
    const current = useSyncExternalStore(subscribe, read, read);
    if (current === null) return null;
    return createElement(Component, { ...current, ...props } as P); // the binding supplies every other prop of P
  }

  return {
    Button,
    bind: (next) => {
      binding = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
