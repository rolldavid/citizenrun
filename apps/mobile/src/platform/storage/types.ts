export type { Unsubscribe } from '../shared';

export type ThemeChoice = 'system' | 'light' | 'dark';

/** An unsent text. */
export type DraftText = {
  text: string; // at most the caption or message limit; cut to that on write
  savedAt: string; // ISO 8601 UTC instant of the write
};

/** Every key the device may hold, with its value (INV-12). */
export type StorageEntries = {
  theme: ThemeChoice;
  'reload.chunkReloaded': true; // visit scope (D-163)
  'reload.upgradeReloaded': true; // visit scope
};

export type StorageKey = Extract<keyof StorageEntries, string>;

export type StorageErrorCode = 'storage.not_hydrated' | 'storage.write_failed';

export interface AppStorage {
  /** Loads persisted values into memory and drops expired or invalid ones. Called once before the first render.
   *  Never rejects: an unreadable store starts empty. */
  hydrate(): Promise<void>;
  /** The value, or null when absent, expired by its rule or invalid. Synchronous; throws
   *  PlatformError('storage', 'storage.not_hydrated') before hydrate() has resolved. */
  get<K extends StorageKey>(key: K): StorageEntries[K] | null;
  /** Writes to memory at once and persists in the background. */
  set<K extends StorageKey>(key: K, value: StorageEntries[K]): void;
  /** Removes one key. Removing an absent key does nothing. */
  remove(key: StorageKey): void;
  /** Removes every key marked "user data": all drafts. Called by session.endLocal(). */
  clearUserData(): void;
  /** Resolves when every write so far is on the device; rejects with 'storage.write_failed' when the last write failed. */
  flush(): Promise<void>;
  /** True when the key's value is held by the device store and not in memory only, so it outlives a reload of
   *  the web page (D-821). Web: the key was read from, or last written to, its browser store with no error; false
   *  when that store is unavailable this visit or the write threw. Phones: a persistent key that holds a value
   *  while no file write has failed; a visit-scope key is memory only and answers false. */
  isPersisted(key: StorageKey): boolean;
}
