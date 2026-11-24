import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as StorageWebIndex from '@/platform/storage/index.web';

import type * as WebIndex from './index.web';
import type { Links } from './types';

// The real web files of links and storage together, in place of the storage fake the setup file
// installs: each call of loadPage() is one page load, with fresh modules over the same browser storage.

/** A Map-backed stand-in for the browser's Storage, whose writes can be scripted to throw. */
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

const reload = vi.fn();

async function loadPage(): Promise<Links> {
  vi.resetModules();
  vi.doMock('@/platform/storage', () =>
    vi.importActual<typeof StorageWebIndex>('@/platform/storage/index.web'),
  );
  const { storage } = await import('@/platform/storage');
  await storage.hydrate();
  return (await vi.importActual<typeof WebIndex>('./index.web')).links;
}

/** reloadOnce('chunk_error') on each of `loads` page loads, as a chunk that keeps failing would call it. */
async function answersOverLoads(loads: number): Promise<boolean[]> {
  const answers: boolean[] = [];
  for (let i = 0; i < loads; i += 1) {
    answers.push((await loadPage()).reloadOnce('chunk_error'));
  }
  return answers;
}

let session: FixtureArea;

beforeEach(() => {
  reload.mockReset();
  session = new FixtureArea();
  vi.stubGlobal('window', { location: { reload } });
  vi.stubGlobal('localStorage', new FixtureArea());
  vi.stubGlobal('sessionStorage', session);
});

afterEach(() => {
  vi.doUnmock('@/platform/storage');
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('reloadOnce over the real storage module', () => {
  it('reloads once per visit when the visit store holds the flag', async () => {
    expect(await answersOverLoads(3)).toEqual([true, false, false]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(session.getItem('s1:reload.chunkReloaded')).toBe('true');
  });

  it('reloads nothing when the visit store cannot be reached', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', { location: { reload } });
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(await answersOverLoads(5)).toEqual([false, false, false, false, false]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads nothing when the visit store refuses the write', async () => {
    session.throwOnSet = true;
    expect(await answersOverLoads(5)).toEqual([false, false, false, false, false]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('answers false again in the same load once the flag could not be kept', async () => {
    session.throwOnSet = true;
    const links = await loadPage();
    expect(links.reloadOnce('upgrade_required')).toBe(false);
    expect(links.reloadOnce('upgrade_required')).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
