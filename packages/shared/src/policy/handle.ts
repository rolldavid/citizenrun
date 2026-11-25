// The pure handle rules (L-handle-rules, D-473). The service part (released handles, availability,
// uniqueness) is the API's L-handle-service and is not here.
import { BRAND } from '../brand.ts';
import { codePointCount } from './code-points.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export const HANDLE_MIN = 3; // L-handle-rules
export const HANDLE_MAX = 20; // L-handle-rules
export const HANDLE_CHANGE_DAYS = 30; // L-handle-rules
export const HANDLE_HOLD_DAYS = 90; // L-handle-rules

export type HandleError =
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'edge_dot'
  | 'double_dot'
  | 'no_letter_or_digit'
  | 'reserved';

/** Route words: a handle is a path segment and must never shadow a route (L-handle-rules). */
export const ROUTE_HANDLE_WORDS = [
  'welcome',
  'signin',
  'sign_in',
  'signup',
  'sign_up',
  'login',
  'logout',
  'onboarding',
  'explore',
  'create',
  'activity',
  'profile',
  'messages',
  'requests',
  'office',
  'offices',
  'c',
  'u',
  'p',
  'm',
  'og',
  'v1',
  'api',
  'map',
  'tiles',
  'search',
  'feed',
  'settings',
  'notifications',
  'calendar',
  'declarations',
  'people',
  'users',
  'posts',
  'comments',
  'uploads',
  'me',
  'privacy',
  'terms',
  'content_policy',
  'child_safety',
  'delete_account',
  'dmca',
  'report_intimate_image',
  'credits',
  'sitemap',
  'robots',
  'healthz',
  'readyz',
  'well_known',
  'go',
  'www',
  'mail',
  'staging',
  'about',
  'account',
  'accounts',
  'app',
  'assets',
  'auth',
  'bookmarks',
  'candidate',
  'candidates',
  'coverage',
  'delete',
  'dev',
  'follow',
  'followers',
  'following',
  'home',
  'inbox',
  'maps',
  'message',
  'person',
  'post',
  'register',
  'report',
  'run',
  'running',
  'static',
  'status',
  'user',
] as const;

/** Role and authority words; one of them followed only by digits is also reserved (L-handle-rules, D-473). */
export const ROLE_HANDLE_WORDS = [
  'administrator',
  'admins',
  'root',
  'moderator',
  'moderators',
  'mod',
  'mods',
  'staff',
  'team',
  'official',
  'officials',
  'help',
  'security',
  'system',
  'sysadmin',
  'owner',
  'verified',
  'null',
  'undefined',
  'anonymous',
  'everyone',
  'nobody',
  'election',
  'elections',
  'election_office',
  'abuse',
  'apple',
  'contact',
  'fec',
  'google',
  'gov',
  'government',
  'helpdesk',
  'info',
  'legal',
  'ncmec',
  'news',
  'press',
  'safety',
  'secretaryofstate',
  'support',
  'trust',
  'admin',
] as const;

const BRAND_SUFFIXES = ['official', 'team', 'support', 'help', 'app'] as const;
const HYPHENS = /-/g;
const SPACES = / /g;

const brandName = BRAND.displayName.toLowerCase();
const variants = Object.values(BRAND.variants);

/** Brand words, built from the brand module so a rename changes them with it (L-handle-rules). */
export const BRAND_HANDLE_WORDS: readonly string[] = [
  brandName,
  ...BRAND_SUFFIXES.map((suffix) => `${brandName}${suffix}`),
  BRAND.slug,
  ...variants.map((variant) => variant.scheme.replace(HYPHENS, '')),
  ...variants.map((variant) => variant.displayName.toLowerCase().replace(SPACES, '')),
];

export const RESERVED_HANDLE_WORDS: ReadonlySet<string> = new Set<string>([
  ...ROUTE_HANDLE_WORDS,
  ...ROLE_HANDLE_WORDS,
  ...BRAND_HANDLE_WORDS,
]);

const SEPARATORS = /[._]/g;
const ALLOWED = /^[a-z0-9_.]+$/;
const LETTER_OR_DIGIT = /[a-z0-9]/;

function strip(word: string): string {
  return word.replace(SEPARATORS, '');
}

const STRIPPED_RESERVED: ReadonlySet<string> = new Set([...RESERVED_HANDLE_WORDS].map(strip));
const BRAND_SLUG_WORD = BRAND.slug.replace(HYPHENS, '');
const ROLE_AND_DIGITS = new RegExp(`^(?:${ROLE_HANDLE_WORDS.map(strip).join('|')})[0-9]+$`);

function isReserved(handle: string): boolean {
  const stripped = strip(handle);
  return (
    STRIPPED_RESERVED.has(stripped) ||
    stripped.includes(BRAND_SLUG_WORD) ||
    ROLE_AND_DIGITS.test(stripped)
  );
}

/** Normalizes and checks a handle; the stored form is lower case without a leading '@'. */
export function validateHandle(
  input: string,
): { ok: true; handle: string } | { ok: false; error: HandleError } {
  const trimmed = input.trim();
  const handle = (trimmed.startsWith('@') ? trimmed.slice(1) : trimmed).toLowerCase();
  const length = codePointCount(handle);
  if (length < HANDLE_MIN) {
    return { ok: false, error: 'too_short' };
  }
  if (length > HANDLE_MAX) {
    return { ok: false, error: 'too_long' };
  }
  if (!ALLOWED.test(handle)) {
    return { ok: false, error: 'invalid_characters' };
  }
  if (handle.startsWith('.') || handle.endsWith('.')) {
    return { ok: false, error: 'edge_dot' };
  }
  if (handle.includes('..')) {
    return { ok: false, error: 'double_dot' };
  }
  if (!LETTER_OR_DIGIT.test(handle)) {
    return { ok: false, error: 'no_letter_or_digit' };
  }
  if (isReserved(handle)) {
    return { ok: false, error: 'reserved' };
  }
  return { ok: true, handle };
}

/** True when a user whose handle last changed at `changedAt` may change it now; true for null. */
export function canChangeHandle(changedAt: Date | null, now: Date): boolean {
  if (changedAt === null) {
    return true;
  }
  return now.getTime() >= changedAt.getTime() + HANDLE_CHANGE_DAYS * DAY_MS;
}
