import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { JSX, ReactNode } from 'react';

export type KeyEventLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  inTextField: boolean;
  preventDefault: () => void;
};

export type ShortcutProviderProps = {
  /** Supplied by the root layout from the platform layer: one keydown listener on the document on the web, a no-op on phones. */
  subscribeKeyDown: (listener: (event: KeyEventLike) => void) => () => void;
  children: ReactNode;
};

export type Shortcut = { key: string; description: string; handler: () => void };

type ActiveShortcut = { key: string; description: string };

type Registration = ActiveShortcut & {
  /** Holds the caller's latest handler, so a new function each render does not register again. */
  handler: { current: () => void };
};

type Registry = {
  onKeyDown: (event: KeyEventLike) => void;
  /** Adds a registration at the end of the list; the returned function removes it. */
  register: (registration: Registration) => () => void;
  /** Counts one more open overlay; the returned function counts it out. */
  block: () => () => void;
  /** Adds a listener for every Escape key event; the returned function removes it. */
  listenEscape: (handler: { current: () => void }) => () => void;
  subscribe: (listener: () => void) => () => void;
  getActive: () => readonly ActiveShortcut[];
};

/** A single character matches in either case (`J` and `j`); every other key matches exactly. */
function sameKey(a: string, b: string): boolean {
  if (a.length === 1 && b.length === 1) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function createRegistry(): Registry {
  // In registration order. The first registration of a key holds it.
  const registrations: Registration[] = [];
  const listeners = new Set<() => void>();
  let blockers = 0;
  let active: readonly ActiveShortcut[] = [];
  // Not registrations: they hear Escape whatever else holds the key, and are never listed.
  const escapeListeners = new Set<{ current: () => void }>();

  const holderOf = (key: string): Registration | undefined =>
    registrations.find((registration) => sameKey(registration.key, key));

  const publish = (): void => {
    active = registrations
      .filter((registration) => holderOf(registration.key) === registration)
      .map(({ key, description }) => ({ key, description }));
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        for (const listener of [...escapeListeners]) {
          listener.current();
        }
      }
      if (event.inTextField || event.altKey || event.ctrlKey || event.metaKey || blockers > 0) {
        return;
      }
      const holder = holderOf(event.key);
      if (holder === undefined) return;
      event.preventDefault();
      holder.handler.current();
    },
    register: (registration) => {
      if (__DEV__ && holderOf(registration.key) !== undefined) {
        throw new Error(`Two shortcuts registered for "${registration.key}"`);
      }
      registrations.push(registration);
      publish();
      return () => {
        const index = registrations.indexOf(registration);
        if (index === -1) return;
        registrations.splice(index, 1);
        publish();
      };
    },
    block: () => {
      blockers += 1;
      return () => {
        blockers -= 1;
      };
    },
    listenEscape: (handler) => {
      escapeListeners.add(handler);
      return () => {
        escapeListeners.delete(handler);
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getActive: () => active,
  };
}

const RegistryContext = createContext<Registry | null>(null);

const NO_SHORTCUTS: readonly ActiveShortcut[] = [];

function subscribeToNothing(): () => void {
  return () => undefined;
}

function getNoShortcuts(): readonly ActiveShortcut[] {
  return NO_SHORTCUTS;
}

/** The shortcut registry (DS-shortcuts): one key subscription for every shortcut under it. */
export function ShortcutProvider({
  subscribeKeyDown,
  children,
}: ShortcutProviderProps): JSX.Element {
  const [registry] = useState(createRegistry);

  useEffect(() => subscribeKeyDown(registry.onKeyDown), [subscribeKeyDown, registry]);

  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>;
}

/**
 * Registers the shortcut while the calling component is mounted and `enabled` is true (the default).
 * The caller passes its screen's focus in `enabled`. A shortcut fires only outside a text field, with
 * no modifier key down and while no overlay blocks the registry.
 *
 * Two registrations of one key are an error in development; elsewhere the first holds the key.
 * Outside a ShortcutProvider nothing is registered.
 */
export function useShortcut(shortcut: Shortcut, enabled = true): void {
  const registry = useContext(RegistryContext);
  const { key, description, handler } = shortcut;
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(() => {
    if (registry === null || !enabled) return undefined;
    return registry.register({ key, description, handler: latest });
  }, [registry, key, description, enabled]);
}

/** The shortcuts registered right now, in registration order, for the list dialog. */
export function useActiveShortcuts(): readonly { key: string; description: string }[] {
  const registry = useContext(RegistryContext);
  return useSyncExternalStore(
    registry?.subscribe ?? subscribeToNothing,
    registry?.getActive ?? getNoShortcuts,
    registry?.getActive ?? getNoShortcuts,
  );
}

/** An overlay calls this while it is open; single-key shortcuts do not fire while any blocker is active. */
export function useShortcutBlocker(active: boolean): void {
  const registry = useContext(RegistryContext);

  useEffect(() => {
    if (registry === null || !active) return undefined;
    return registry.block();
  }, [registry, active]);
}

/** Calls the handler on every Escape key event while `enabled` is true. Not a registry shortcut. */
export function useEscapeListener(handler: () => void, enabled: boolean): void {
  const registry = useContext(RegistryContext);
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(() => {
    if (registry === null || !enabled) return undefined;
    return registry.listenEscape(latest);
  }, [registry, enabled]);
}
