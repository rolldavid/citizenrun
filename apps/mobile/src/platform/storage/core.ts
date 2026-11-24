import { ruleFor } from './keys';
import type { StorageScope } from './keys';
import type { StorageEntries, StorageKey } from './types';

export type StorageCore = {
  /** Loads entries read from one scope. Keeps a key only when ruleFor() finds it, the rule's scope is this
   *  scope, isValid is true and isExpired is false at `now`; a key already in memory is not overwritten.
   *  Returns the names it did not keep, so the caller removes them from the device. */
  load(scope: StorageScope, entries: Iterable<readonly [string, unknown]>, now: Date): string[];
  /** Null when absent or expired. */
  get<K extends StorageKey>(key: K, now: Date): StorageEntries[K] | null;
  set<K extends StorageKey>(key: K, value: StorageEntries[K]): void;
  remove(key: StorageKey): void;
  userDataKeys(): StorageKey[];
  /** The current entries of one scope, for writing to the device. */
  entries(scope: StorageScope): [StorageKey, unknown][];
};

/** The memory store both index files wrap. */
export function createStorageCore(): StorageCore {
  const values = new Map<StorageKey, unknown>();

  return {
    load: (scope, entries, now) => {
      const dropped: string[] = [];
      for (const [name, value] of entries) {
        const rule = ruleFor(name);
        if (
          rule === null ||
          rule.scope !== scope ||
          !rule.isValid(value) ||
          rule.isExpired(value, now)
        ) {
          dropped.push(name);
          continue;
        }
        // ruleFor found a row, so the name is a key
        const key = name as StorageKey;
        if (!values.has(key)) {
          values.set(key, value);
        }
      }
      return dropped;
    },
    get: <K extends StorageKey>(key: K, now: Date): StorageEntries[K] | null => {
      if (!values.has(key)) {
        return null;
      }
      const value = values.get(key);
      const rule = ruleFor(key);
      if (rule === null || !rule.isValid(value) || rule.isExpired(value, now)) {
        return null;
      }
      return value as StorageEntries[K]; // set() and load() only store values of the key's shape
    },
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
    userDataKeys: () => [...values.keys()].filter((key) => ruleFor(key)?.userData === true),
    entries: (scope) => [...values.entries()].filter(([key]) => ruleFor(key)?.scope === scope),
  };
}
