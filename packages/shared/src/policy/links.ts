export const SAFE_URL_MAX = 200; // L-links
export const SOURCE_URL_MAX = 2048; // L-links, D-536

const SCHEME_AND_REST = /^https:\/\/([^/?#]*)([\s\S]*)$/i;
const HOST_AND_PORT = /^([^:]+)(:\d{1,5})?$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LAST_LABEL = /^[a-z]{2,24}$/;
const DIGITS = /^\d+$/;
const WHITESPACE = /\s/;

function hasWhitespaceOrControl(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || WHITESPACE.test(char)) {
      return true;
    }
  }
  return false;
}

/**
 * An https URL a user or a source may store, with its domain for display; null when not acceptable.
 * `maxLength` is SAFE_URL_MAX for a link a user stores, SOURCE_URL_MAX for a link a bundle stores.
 * A pattern check, never `URL`, which React Native implements only in part.
 */
export function parseSafeUrl(
  input: string,
  maxLength: number = SAFE_URL_MAX,
): { url: string; domain: string } | null {
  const text = input.trim();
  if (text.length > maxLength) {
    return null;
  }
  const parts = SCHEME_AND_REST.exec(text);
  if (parts === null) {
    return null;
  }
  const authority = parts[1] ?? '';
  const rest = parts[2] ?? '';
  if (authority.includes('@') || authority.startsWith('[')) {
    return null;
  }
  const hostAndPort = HOST_AND_PORT.exec(authority);
  if (hostAndPort === null) {
    return null;
  }
  const host = (hostAndPort[1] ?? '').toLowerCase();
  const port = hostAndPort[2] ?? '';
  const labels = host.split('.');
  const last = labels[labels.length - 1] ?? '';
  if (
    labels.length < 2 ||
    labels.every((label) => DIGITS.test(label)) ||
    !labels.every((label) => LABEL.test(label)) ||
    !LAST_LABEL.test(last)
  ) {
    return null;
  }
  if (hasWhitespaceOrControl(rest)) {
    return null;
  }
  return {
    url: `https://${host}${port}${rest}`,
    domain: host.startsWith('www.') ? host.slice('www.'.length) : host,
  };
}
