import type { StorageKey, ThemeChoice } from './types';

export type StorageScope = 'persistent' | 'visit';

export type StorageKeyRule = Readonly<{
  scope: StorageScope;
  /** Removed by clearUserData(). */
  userData: boolean;
  /** True when a stored value has the key's shape. */
  isValid: (value: unknown) => boolean;
  /** True when a valid stored value has expired at `now`. */
  isExpired: (value: unknown, now: Date) => boolean;
}>;

const THEME_CHOICES: readonly unknown[] = ['system', 'light', 'dark'] satisfies ThemeChoice[];

function isThemeChoice(value: unknown): boolean {
  return THEME_CHOICES.includes(value);
}

function isTrue(value: unknown): boolean {
  return value === true;
}

function neverExpires(): boolean {
  return false;
}

/** PM-storage's key table. */
export const STORAGE_KEY_RULES = {
  theme: { scope: 'persistent', userData: false, isValid: isThemeChoice, isExpired: neverExpires },
  'reload.chunkReloaded': {
    scope: 'visit',
    userData: false,
    isValid: isTrue,
    isExpired: neverExpires,
  },
  'reload.upgradeReloaded': {
    scope: 'visit',
    userData: false,
    isValid: isTrue,
    isExpired: neverExpires,
  },
} as const satisfies Record<StorageKey, StorageKeyRule>;

/** Every key or key family the device may hold, as written in PM-storage's table. */
export const STORAGE_KEY_PATTERNS: readonly string[] = Object.keys(STORAGE_KEY_RULES);

/** True when the name is one of the fixed keys. */
export function isStorageKey(key: string): key is StorageKey {
  return Object.hasOwn(STORAGE_KEY_RULES, key);
}

/** The rule for a stored key name, or null when the name matches no row. */
export function ruleFor(key: string): StorageKeyRule | null {
  if (isStorageKey(key)) {
    return STORAGE_KEY_RULES[key];
  }
  return null;
}

export const STORAGE_FILE_NAME = 'kv-v1.json'; // PM-storage
export const WEB_KEY_PREFIX = 's1:'; // PM-storage
