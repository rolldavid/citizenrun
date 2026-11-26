// Office and person slugs (PIPE-slugs). The one slug code for the pipeline, the worker and the app.
import { sha256Hex } from './sha256.ts';

/** The longest office base: room for a `-<n>` suffix within the 120 characters of a slug. */
export const OFFICE_SLUG_BASE_MAX = 113;
/** The longest name part of a person slug. */
export const PERSON_SLUG_NAME_MAX = 100;
/** The hex characters of the source key's hash at the end of a person slug. */
export const PERSON_SLUG_HASH_CHARS = 8;

/**
 * NFKD with combining marks removed, lower-case, `&` to `and`, every run of characters outside
 * `a-z0-9` to one `-`, and no `-` at either end.
 */
export function kebab(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `slug` cut at its last hyphen at or before `max` characters; a slug with no such hyphen is cut at `max`. */
function cutAtHyphen(slug: string, max: number): string {
  if (slug.length <= max) {
    return slug;
  }
  const cut = slug.slice(0, max + 1).lastIndexOf('-');
  return cut > 0 ? slug.slice(0, cut) : slug.slice(0, max).replace(/-+$/, '');
}

/**
 * The base slug of an office: the state and the title when the title already names the
 * jurisdiction, else the state, the jurisdiction's name and the title.
 */
export function officeSlugBase(state: string, jurisdictionName: string, title: string): string {
  const base = kebab(title).includes(kebab(jurisdictionName))
    ? kebab(`${state} ${title}`)
    : kebab(`${state} ${jurisdictionName} ${title}`);
  return cutAtHyphen(base, OFFICE_SLUG_BASE_MAX);
}

/** A person's slug: the kebab name cut at 100 characters, `-`, then 8 hex characters of SHA-256 of the source key. */
export function personSlug(name: string, sourceKey: string): string {
  const namePart = kebab(name).slice(0, PERSON_SLUG_NAME_MAX).replace(/-+$/, '');
  const hash = sha256Hex(sourceKey).slice(0, PERSON_SLUG_HASH_CHARS);
  return namePart === '' ? hash : `${namePart}-${hash}`;
}
