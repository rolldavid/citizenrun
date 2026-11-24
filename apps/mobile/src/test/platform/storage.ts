import { PlatformError } from '@/platform/shared';
import { ruleFor } from '@/platform/storage/keys';
import type { AppStorage, StorageEntries, StorageKey } from '@/platform/storage/types';

/** Keys only: a value is never recorded, so a test log cannot hold a typed text. */
export type StorageFakeCall =
  { op: 'set'; key: StorageKey } | { op: 'remove'; key: StorageKey } | { op: 'clearUserData' };

const calls: StorageFakeCall[] = [];
const values = new Map<StorageKey, unknown>();
const state = { failNextFlush: false, persists: true };

function read<K extends StorageKey>(key: K): StorageEntries[K] | null {
  if (!values.has(key)) {
    return null;
  }
  const value = values.get(key);
  const rule = ruleFor(key);
  if (rule === null || !rule.isValid(value) || rule.isExpired(value, new Date())) {
    return null;
  }
  return value as StorageEntries[K]; // the key's rule accepted the value
}

export const storage: AppStorage = {
  hydrate: () => Promise.resolve(),
  get: read,
  set: (key, value) => {
    calls.push({ op: 'set', key });
    values.set(key, value);
  },
  remove: (key) => {
    calls.push({ op: 'remove', key });
    values.delete(key);
  },
  clearUserData: () => {
    calls.push({ op: 'clearUserData' });
    for (const key of [...values.keys()]) {
      if (ruleFor(key)?.userData === true) {
        values.delete(key);
      }
    }
  },
  flush: () => {
    if (state.failNextFlush) {
      state.failNextFlush = false;
      return Promise.reject(new PlatformError('storage', 'storage.write_failed'));
    }
    return Promise.resolve();
  },
  isPersisted: (key) => state.persists && values.has(key),
};

export const storageFake = {
  calls: calls as readonly StorageFakeCall[],
  /** Preloads values as hydrate() would have read them; get() still applies each key's rule. */
  seed: (entries: Partial<StorageEntries>): void => {
    for (const [key, value] of Object.entries(entries)) {
      values.set(key as StorageKey, value); // the keys of a Partial<StorageEntries>
    }
  },
  /** The next flush() rejects with storage.write_failed. */
  failNextFlush: (): void => {
    state.failNextFlush = true;
  },
  /** isPersisted() answers false for every key until reset(), as a browser whose storage is blocked. */
  memoryOnly: (): void => {
    state.persists = false;
  },
  reset: (): void => {
    calls.length = 0;
    values.clear();
    state.failNextFlush = false;
    state.persists = true;
  },
};
