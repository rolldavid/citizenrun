import { PlatformError } from '@/platform/shared';

import { createStorageCore } from './core';
import { ruleFor, WEB_KEY_PREFIX } from './keys';
import type { StorageScope } from './keys';
import type { AppStorage, StorageKey } from './types';

/** The part of the browser's Storage this module uses. */
type WebArea = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

const core = createStorageCore();
const unavailable = new Set<StorageScope>();
let hydrated = false;
let hydrating: Promise<void> | null = null;
let lastWriteError: PlatformError | null = null;

/** The scope's browser store, or null when it is missing or has failed this visit. */
function areaOf(scope: StorageScope): WebArea | null {
  if (unavailable.has(scope)) {
    return null;
  }
  try {
    const area: unknown =
      scope === 'persistent' ? globalThis.localStorage : globalThis.sessionStorage;
    if (typeof area !== 'object' || area === null) {
      unavailable.add(scope);
      return null;
    }
    return area as WebArea; // the global is the browser's Storage when it is an object
  } catch {
    // a private window can throw SecurityError on the property access itself
    unavailable.add(scope);
    return null;
  }
}

function hydrateScope(scope: StorageScope, now: Date): void {
  const area = areaOf(scope);
  if (area === null) {
    return;
  }
  try {
    const names: string[] = [];
    for (let i = 0; i < area.length; i += 1) {
      const name = area.key(i);
      if (name?.startsWith(WEB_KEY_PREFIX) === true) {
        names.push(name);
      }
    }
    const entries: [string, unknown][] = [];
    for (const name of names) {
      const key = name.slice(WEB_KEY_PREFIX.length);
      try {
        const text = area.getItem(name);
        if (text === null) {
          continue;
        }
        entries.push([key, JSON.parse(text)]);
      } catch {
        area.removeItem(name);
      }
    }
    for (const key of core.load(scope, entries, now)) {
      area.removeItem(WEB_KEY_PREFIX + key);
    }
  } catch {
    unavailable.add(scope);
  }
}

function writeThrough(key: StorageKey, value: unknown): void {
  const rule = ruleFor(key);
  if (rule === null) {
    return;
  }
  const area = areaOf(rule.scope);
  if (area === null) {
    return;
  }
  try {
    if (value === undefined) {
      area.removeItem(WEB_KEY_PREFIX + key);
    } else {
      area.setItem(WEB_KEY_PREFIX + key, JSON.stringify(value));
    }
    lastWriteError = null;
  } catch {
    unavailable.add(rule.scope);
    lastWriteError = new PlatformError('storage', 'storage.write_failed');
  }
}

function load(): Promise<void> {
  const now = new Date();
  hydrateScope('persistent', now);
  hydrateScope('visit', now);
  hydrated = true;
  return Promise.resolve();
}

export const storage: AppStorage = {
  hydrate: () => {
    hydrating ??= load();
    return hydrating;
  },
  get: (key) => {
    if (!hydrated) {
      throw new PlatformError('storage', 'storage.not_hydrated');
    }
    return core.get(key, new Date());
  },
  // The write happens in the same call: links.reloadOnce reloads the page right after set().
  set: (key, value) => {
    core.set(key, value);
    writeThrough(key, value);
  },
  remove: (key) => {
    core.remove(key);
    writeThrough(key, undefined);
  },
  clearUserData: () => {
    for (const key of core.userDataKeys()) {
      core.remove(key);
      writeThrough(key, undefined);
    }
  },
  flush: () => (lastWriteError === null ? Promise.resolve() : Promise.reject(lastWriteError)),
};

export type * from './types';
