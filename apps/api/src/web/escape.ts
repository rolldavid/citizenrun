// The one way the API writes text, links and data into HTML (CTL-03, L-html-escape, INV-55).
import { SOURCE_URL_MAX, parseSafeUrl } from '@citizenrun/shared';

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// The characters a JSON text may hold that would end or confuse a script block (L-html-escape).
const SCRIPT_ESCAPES: Readonly<Record<string, string>> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/** Text made safe for HTML element content and attribute values: `& < > " '` become entities. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}

/**
 * True for a path whose first character is `/` and whose second is neither `/` nor `\`, or for a
 * URL `parseSafeUrl(url, SOURCE_URL_MAX)` accepts (D-536). `/\host` is refused: browsers read it as
 * another origin.
 */
export function isSafeHref(url: string): boolean {
  if (url.startsWith('/')) {
    const second = url.charAt(1);
    return second !== '/' && second !== '\\';
  }
  return parseSafeUrl(url, SOURCE_URL_MAX) !== null;
}

/** `JSON.stringify(value)`, then `<`, `>`, `&`, U+2028 and U+2029 written as their `\u` escapes. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (character) => SCRIPT_ESCAPES[character] ?? character,
  );
}
