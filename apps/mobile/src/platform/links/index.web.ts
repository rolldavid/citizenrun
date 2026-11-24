import { parseSafeUrl, SOURCE_URL_MAX } from '@citizenrun/shared';
import { z } from 'zod';

import { storage } from '@/platform/storage';

import type { Links, OpenOutcome, PageKeyEvent, ReloadReason } from './types';

const EmailSchema = z.email();

const TEXT_FIELD_TAGS: readonly string[] = ['INPUT', 'TEXTAREA', 'SELECT'];

function reloadKey(reason: ReloadReason): 'reload.chunkReloaded' | 'reload.upgradeReloaded' {
  return reason === 'chunk_error' ? 'reload.chunkReloaded' : 'reload.upgradeReloaded';
}

function isTextField(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) {
    return false;
  }
  // an engine that does not implement isContentEditable leaves it undefined
  const editable: unknown = Reflect.get(target, 'isContentEditable');
  return TEXT_FIELD_TAGS.includes(target.tagName) || editable === true;
}

/** The page's font set, or null when this browser has none. */
function pageFonts(): FontFaceSet | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const fonts: unknown = Reflect.get(document, 'fonts');
  return typeof fonts === 'object' && fonts !== null ? (fonts as FontFaceSet) : null; // the DOM's document.fonts when present
}

export const links: Links = {
  // Not async: window.open must run inside the caller's press handler.
  openExternal: (url) => {
    const safe = parseSafeUrl(url, SOURCE_URL_MAX);
    if (safe === null) {
      return Promise.resolve<OpenOutcome>('refused');
    }
    try {
      window.open(safe.url, '_blank', 'noopener,noreferrer'); // returns null with noopener by design
      return Promise.resolve<OpenOutcome>('opened');
    } catch {
      return Promise.resolve<OpenOutcome>('failed');
    }
  },
  openMail: (address) => {
    if (!EmailSchema.safeParse(address).success) {
      return Promise.resolve<OpenOutcome>('refused');
    }
    try {
      window.location.href = 'mailto:' + address;
      return Promise.resolve<OpenOutcome>('opened');
    } catch {
      return Promise.resolve<OpenOutcome>('failed');
    }
  },
  openAppSettings: () => Promise.resolve(false),
  storeListingSupported: false,
  // The website reloads instead.
  openStoreListing: () => Promise.resolve(false),
  reloadOnce: (reason) => {
    const key = reloadKey(reason);
    let done: true | null;
    try {
      done = storage.get(key);
    } catch {
      return false; // storage not hydrated: never risk a reload loop
    }
    if (done === true) {
      return false;
    }
    storage.set(key, true);
    window.location.reload();
    return true;
  },
  subscribeKeyDown: (listener) => {
    const handler = (event: KeyboardEvent): void => {
      if (event.isComposing) {
        return;
      }
      const pageEvent: PageKeyEvent = {
        key: event.key,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        inTextField: isTextField(event.target),
        preventDefault: () => {
          event.preventDefault();
        },
      };
      listener(pageEvent);
    };
    document.addEventListener('keydown', handler);
    let removed = false;
    return () => {
      if (removed) {
        return;
      }
      removed = true;
      document.removeEventListener('keydown', handler);
    };
  },
  fontsReady: async (faces) => {
    const fonts = pageFonts();
    if (fonts === null) {
      return false;
    }
    try {
      // 16px: the CSS font syntax requires a size; it does not change which face loads and is not a design value
      const loaded = await Promise.all(
        faces.map((f) => fonts.load(String(f.weight) + ' 16px "' + f.family + '"')),
      );
      return loaded.every((list) => list.length > 0);
    } catch {
      return false;
    }
  },
};

export type * from './types';
