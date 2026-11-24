import { File, Paths } from 'expo-file-system';

import { PlatformError } from '@/platform/shared';

import { createStorageCore } from './core';
import { ruleFor, STORAGE_FILE_NAME } from './keys';
import type { AppStorage, StorageKey } from './types';

const core = createStorageCore();
let hydrated = false;
let hydrating: Promise<void> | null = null;
let dirty = false;
let scheduled = false;
let chain: Promise<void> = Promise.resolve();
let lastWriteError: PlatformError | null = null;

/** The members of expo-file-system's File this module uses (SDK 58: `exists`, `text()`, the asynchronous `write`). */
type StoreFile = {
  readonly exists: boolean;
  text(): Promise<string>;
  write(content: string): Promise<void>;
};

function storeFile(): StoreFile {
  const file: unknown = new File(Paths.document, STORAGE_FILE_NAME);
  return file as StoreFile; // the web type-check reads the library's web typing, whose File declares none of these members
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

async function readStored(): Promise<Record<string, unknown>> {
  try {
    const file = storeFile();
    if (!file.exists) {
      return {};
    }
    const parsed: unknown = JSON.parse(await file.text());
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeNow(): Promise<void> {
  if (!dirty) {
    return;
  }
  dirty = false;
  try {
    await storeFile().write(JSON.stringify(Object.fromEntries(core.entries('persistent'))));
    lastWriteError = null;
  } catch {
    lastWriteError = new PlatformError('storage', 'storage.write_failed');
    dirty = true;
  }
}

/** Several changes in one tick make one write; writes run one after another. */
function scheduleWrite(): void {
  dirty = true;
  if (scheduled) {
    return;
  }
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    chain = chain.then(writeNow);
  });
}

function changed(key: StorageKey): void {
  if (ruleFor(key)?.scope === 'persistent') {
    scheduleWrite();
  }
}

async function load(): Promise<void> {
  const stored = await readStored();
  const dropped = core.load('persistent', Object.entries(stored), new Date());
  if (dropped.length > 0) {
    scheduleWrite();
  }
  hydrated = true;
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
  set: (key, value) => {
    core.set(key, value);
    changed(key);
  },
  remove: (key) => {
    core.remove(key);
    changed(key);
  },
  clearUserData: () => {
    for (const key of core.userDataKeys()) {
      core.remove(key);
      changed(key);
    }
  },
  flush: async () => {
    await Promise.resolve(); // lets a write scheduled in this tick join the chain
    await chain;
    if (lastWriteError !== null) {
      throw lastWriteError;
    }
  },
};

export type * from './types';
