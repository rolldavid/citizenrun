import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';
import type { AppStorage } from './types';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  /** Each write, in call order; `done` is set when its promise settles. */
  writes: [] as { text: string; done: boolean }[],
  /** Scripted answers for the next writes; a missing entry writes at once. */
  nextWrites: [] as (() => Promise<void>)[],
  textFails: false,
}));

vi.mock('expo-file-system', () => {
  class File {
    private readonly name: string;
    constructor(_directory: unknown, name: string) {
      this.name = name;
    }
    get exists(): boolean {
      return fs.files.has(this.name);
    }
    text(): Promise<string> {
      if (fs.textFails) {
        return Promise.reject(new Error('fixture read failure'));
      }
      return Promise.resolve(fs.files.get(this.name) ?? '');
    }
    async write(text: string): Promise<void> {
      const entry = { text, done: false };
      fs.writes.push(entry);
      const scripted = fs.nextWrites.shift();
      try {
        if (scripted !== undefined) {
          await scripted();
        }
        fs.files.set(this.name, text);
      } finally {
        entry.done = true;
      }
    }
  }
  return { File, Paths: { document: { uri: 'fixture-document-directory' } } };
});

const FILE_NAME = 'kv-v1.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2027-03-10T12:00:00.000Z');

/** A Map-backed stand-in for the browser's Storage, whose methods can be scripted to throw. */
class FixtureArea {
  readonly map = new Map<string, string>();
  throwOnSet = false;
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(name: string): string | null {
    return this.map.get(name) ?? null;
  }
  setItem(name: string, value: string): void {
    if (this.throwOnSet) {
      throw new Error('QuotaExceededError');
    }
    this.map.set(name, value);
  }
  removeItem(name: string): void {
    this.map.delete(name);
  }
}

async function freshNative(): Promise<AppStorage> {
  vi.resetModules();
  return (await vi.importActual<typeof NativeIndex>('./index.native')).storage;
}

async function freshWeb(): Promise<AppStorage> {
  vi.resetModules();
  return (await vi.importActual<typeof WebIndex>('./index.web')).storage;
}

function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error: unknown) {
    return error;
  }
  return null;
}

function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

function storedFile(): unknown {
  const text = fs.files.get(FILE_NAME);
  return text === undefined ? undefined : JSON.parse(text);
}

let local: FixtureArea;
let session: FixtureArea;

beforeEach(() => {
  fs.files.clear();
  fs.writes.length = 0;
  fs.nextWrites.length = 0;
  fs.textFails = false;
  local = new FixtureArea();
  session = new FixtureArea();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'localStorage');
  vi.useRealTimers();
});

describe('storage', () => {
  it('get before hydrate throws storage.not_hydrated', async () => {
    for (const storage of [await freshNative(), await freshWeb()]) {
      expect(thrown(() => storage.get('theme'))).toMatchObject({
        name: 'PlatformError',
        module: 'storage',
        code: 'storage.not_hydrated',
      });
    }
  });

  it('the theme survives a restart', async () => {
    const first = await freshNative();
    await first.hydrate();
    first.set('theme', 'dark');
    await first.flush();
    const second = await freshNative();
    await second.hydrate();
    expect(second.get('theme')).toBe('dark');

    const web = await freshWeb();
    await web.hydrate();
    web.set('theme', 'dark');
    expect(local.getItem('s1:theme')).toBe('"dark"');
    const webAgain = await freshWeb();
    await webAgain.hydrate();
    expect(webAgain.get('theme')).toBe('dark');
  });

  it('invalid values are dropped', async () => {
    fs.files.set(FILE_NAME, JSON.stringify({ theme: 'sepia', 'ageGate.blockedUntil': 'tomorrow' }));
    const native = await freshNative();
    await native.hydrate();
    expect(native.get('theme')).toBeNull();
    expect(native.get('ageGate.blockedUntil')).toBeNull();
    await native.flush();
    expect(storedFile()).toEqual({});

    local.setItem('s1:theme', '"sepia"');
    local.setItem('s1:ageGate.blockedUntil', '"tomorrow"');
    const web = await freshWeb();
    await web.hydrate();
    expect(web.get('theme')).toBeNull();
    expect(local.getItem('s1:theme')).toBeNull();
    expect(web.get('ageGate.blockedUntil')).toBeNull();
    expect(local.getItem('s1:ageGate.blockedUntil')).toBeNull();
  });

  it('expiry rules', async () => {
    vi.setSystemTime(NOW);
    const past = new Date(NOW.getTime() - 1).toISOString();
    const dayAhead = new Date(NOW.getTime() + DAY_MS).toISOString();

    fs.files.set(FILE_NAME, JSON.stringify({ 'ageGate.blockedUntil': past }));
    const nativePast = await freshNative();
    await nativePast.hydrate();
    expect(nativePast.get('ageGate.blockedUntil')).toBeNull();
    await nativePast.flush();
    expect(storedFile()).toEqual({});

    fs.files.set(FILE_NAME, JSON.stringify({ 'ageGate.blockedUntil': dayAhead }));
    const nativeAhead = await freshNative();
    await nativeAhead.hydrate();
    expect(nativeAhead.get('ageGate.blockedUntil')).toBe(dayAhead);
    await nativeAhead.flush();
    expect(storedFile()).toEqual({ 'ageGate.blockedUntil': dayAhead });

    local.setItem('s1:ageGate.blockedUntil', JSON.stringify(past));
    const webPast = await freshWeb();
    await webPast.hydrate();
    expect(webPast.get('ageGate.blockedUntil')).toBeNull();
    expect(local.getItem('s1:ageGate.blockedUntil')).toBeNull();

    local.setItem('s1:ageGate.blockedUntil', JSON.stringify(dayAhead));
    const webAhead = await freshWeb();
    await webAhead.hydrate();
    expect(webAhead.get('ageGate.blockedUntil')).toBe(dayAhead);
    expect(local.getItem('s1:ageGate.blockedUntil')).toBe(JSON.stringify(dayAhead));

    // a lock kept at hydrate() reads as absent once its instant is reached
    vi.setSystemTime(new Date(NOW.getTime() + DAY_MS));
    expect(nativeAhead.get('ageGate.blockedUntil')).toBeNull();
    expect(webAhead.get('ageGate.blockedUntil')).toBeNull();
  });

  it('unknown keys are dropped', async () => {
    local.setItem('s1:token', '"x"');
    local.setItem('other-app-key', 'kept');
    const web = await freshWeb();
    await web.hydrate();
    expect(local.getItem('s1:token')).toBeNull();
    expect(local.getItem('other-app-key')).toBe('kept');

    fs.files.set(FILE_NAME, JSON.stringify({ token: 'x' }));
    const native = await freshNative();
    await native.hydrate();
    expect(native.get('theme')).toBeNull();
    await native.flush();
    expect(fs.writes).toHaveLength(1);
    expect(storedFile()).toEqual({});
  });

  it('an unparsable web value is removed', async () => {
    local.setItem('s1:theme', 'not json');
    const web = await freshWeb();
    await web.hydrate();
    expect(web.get('theme')).toBeNull();
    expect(local.getItem('s1:theme')).toBeNull();
  });

  it("visit keys never reach the phone's file", async () => {
    const native = await freshNative();
    await native.hydrate();
    native.set('theme', 'light');
    native.set('reload.chunkReloaded', true);
    await native.flush();
    expect(fs.files.get(FILE_NAME)).not.toContain('reload.');
    expect(storedFile()).toEqual({ theme: 'light' });
    expect(native.get('reload.chunkReloaded')).toBe(true);

    const web = await freshWeb();
    await web.hydrate();
    web.set('reload.chunkReloaded', true);
    expect(session.getItem('s1:reload.chunkReloaded')).toBe('true');
    expect(local.getItem('s1:reload.chunkReloaded')).toBeNull();
  });

  it('a visit key in the phone file is dropped', async () => {
    fs.files.set(FILE_NAME, JSON.stringify({ 'reload.chunkReloaded': true, theme: 'dark' }));
    const native = await freshNative();
    await native.hydrate();
    expect(native.get('reload.chunkReloaded')).toBeNull();
    expect(native.get('theme')).toBe('dark');
    await native.flush();
    expect(storedFile()).toEqual({ theme: 'dark' });
  });

  it('a key in the wrong scope is dropped', async () => {
    local.setItem('s1:reload.chunkReloaded', 'true');
    session.setItem('s1:theme', '"dark"');
    const web = await freshWeb();
    await web.hydrate();
    expect(local.getItem('s1:reload.chunkReloaded')).toBeNull();
    expect(session.getItem('s1:theme')).toBeNull();
    expect(web.get('reload.chunkReloaded')).toBeNull();
    expect(web.get('theme')).toBeNull();
  });

  it('the theme never expires', async () => {
    fs.files.set(FILE_NAME, JSON.stringify({ theme: 'dark' }));
    local.setItem('s1:theme', '"light"');
    vi.setSystemTime(new Date(Date.now() + 10 * 366 * 24 * 60 * 60 * 1000));
    const native = await freshNative();
    await native.hydrate();
    expect(native.get('theme')).toBe('dark');
    const web = await freshWeb();
    await web.hydrate();
    expect(web.get('theme')).toBe('light');
  });

  it('clearUserData keeps the theme, the reload flags and the gate lock', async () => {
    const lock = new Date(Date.now() + DAY_MS).toISOString();
    for (const storage of [await freshNative(), await freshWeb()]) {
      await storage.hydrate();
      storage.set('theme', 'dark');
      storage.set('reload.chunkReloaded', true);
      storage.set('reload.upgradeReloaded', true);
      storage.set('ageGate.blockedUntil', lock);
      storage.clearUserData();
      expect(storage.get('theme')).toBe('dark');
      expect(storage.get('reload.chunkReloaded')).toBe(true);
      expect(storage.get('reload.upgradeReloaded')).toBe(true);
      expect(storage.get('ageGate.blockedUntil')).toBe(lock);
    }
    expect(local.getItem('s1:ageGate.blockedUntil')).toBe(JSON.stringify(lock));
  });

  it('native writes are coalesced and ordered', async () => {
    const native = await freshNative();
    await native.hydrate();
    const firstWrite = deferred();
    fs.nextWrites.push(() => firstWrite.promise);

    native.set('theme', 'dark');
    native.set('theme', 'light');
    native.set('reload.chunkReloaded', true);
    const flushed = native.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(fs.writes).toHaveLength(1);

    native.set('theme', 'system');
    await Promise.resolve();
    await Promise.resolve();
    // the second batch waits for the first write to settle
    expect(fs.writes).toHaveLength(1);

    let flushDone = false;
    void flushed.then(() => {
      flushDone = true;
    });
    await Promise.resolve();
    expect(flushDone).toBe(false);

    firstWrite.resolve();
    await flushed;
    await native.flush();
    expect(fs.writes).toHaveLength(2);
    expect(fs.writes[0]).toEqual({ text: JSON.stringify({ theme: 'light' }), done: true });
    expect(fs.writes[1]).toEqual({ text: JSON.stringify({ theme: 'system' }), done: true });
    expect(storedFile()).toEqual({ theme: 'system' });
  });

  it('a failed native write is reported and retried', async () => {
    const native = await freshNative();
    await native.hydrate();
    fs.nextWrites.push(() => Promise.reject(new Error('disk full')));
    native.set('theme', 'dark');
    expect(await rejection(native.flush())).toMatchObject({
      name: 'PlatformError',
      code: 'storage.write_failed',
    });
    expect(native.get('theme')).toBe('dark');

    native.set('reload.upgradeReloaded', true);
    native.set('theme', 'light');
    await native.flush();
    expect(fs.writes).toHaveLength(2);
    expect(storedFile()).toEqual({ theme: 'light' });
  });

  it('an unreadable store starts empty', async () => {
    fs.files.set(FILE_NAME, JSON.stringify({ theme: 'dark' }));
    fs.textFails = true;
    const failing = await freshNative();
    await failing.hydrate();
    expect(failing.get('theme')).toBeNull();

    fs.textFails = false;
    for (const text of ['not json', '[]', 'null', '"dark"']) {
      fs.files.set(FILE_NAME, text);
      const native = await freshNative();
      await native.hydrate();
      expect(native.get('theme')).toBeNull();
    }
  });

  it('hydrate answers one promise', async () => {
    const native = await freshNative();
    expect(native.hydrate()).toBe(native.hydrate());
    const web = await freshWeb();
    expect(web.hydrate()).toBe(web.hydrate());
  });

  it('web falls back to memory', async () => {
    const web = await freshWeb();
    await web.hydrate();
    local.throwOnSet = true;
    web.set('theme', 'light');
    expect(web.get('theme')).toBe('light');
    expect(await rejection(web.flush())).toMatchObject({
      name: 'PlatformError',
      code: 'storage.write_failed',
    });
  });

  it('blocked browser storage still works', async () => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    const web = await freshWeb();
    await web.hydrate();
    web.set('theme', 'dark');
    expect(web.get('theme')).toBe('dark');
    await web.flush();
  });

  it('isPersisted follows the browser store', async () => {
    session.setItem('s1:reload.upgradeReloaded', 'true');
    const web = await freshWeb();
    await web.hydrate();
    expect(web.isPersisted('reload.upgradeReloaded')).toBe(true);
    expect(web.isPersisted('reload.chunkReloaded')).toBe(false);
    web.set('reload.chunkReloaded', true);
    expect(web.isPersisted('reload.chunkReloaded')).toBe(true);
    web.remove('reload.chunkReloaded');
    expect(web.isPersisted('reload.chunkReloaded')).toBe(false);
    local.throwOnSet = true;
    web.set('theme', 'dark');
    expect(web.get('theme')).toBe('dark');
    expect(web.isPersisted('theme')).toBe(false);
  });

  it('isPersisted is false while the browser store is blocked', async () => {
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    const web = await freshWeb();
    await web.hydrate();
    web.set('reload.chunkReloaded', true);
    expect(web.get('reload.chunkReloaded')).toBe(true);
    expect(web.isPersisted('reload.chunkReloaded')).toBe(false);
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('isPersisted on phones: persistent keys only', async () => {
    const native = await freshNative();
    await native.hydrate();
    native.set('reload.chunkReloaded', true);
    expect(native.isPersisted('reload.chunkReloaded')).toBe(false);
    expect(native.isPersisted('theme')).toBe(false);
    native.set('theme', 'dark');
    expect(native.isPersisted('theme')).toBe(true);
  });

  it('web writes happen in the same call', async () => {
    const web = await freshWeb();
    await web.hydrate();
    web.set('reload.chunkReloaded', true);
    expect(session.getItem('s1:reload.chunkReloaded')).toBe('true');
    web.remove('reload.chunkReloaded');
    expect(session.getItem('s1:reload.chunkReloaded')).toBeNull();
    expect(web.get('reload.chunkReloaded')).toBeNull();
  });
});
