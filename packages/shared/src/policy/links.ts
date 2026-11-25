export const SAFE_URL_MAX = 200; // L-links
export const SOURCE_URL_MAX = 2048; // L-links, D-536
export const LINK_REL = 'nofollow ugc noopener noreferrer'; // L-links

export type TextSegment =
  { type: 'text'; value: string } | { type: 'link'; value: string; href: string; domain: string };

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

const HTTPS_RUN = /https:\/\/[^\s<>"']*/gi;
const TRAILING_PUNCTUATION = '.,;:!?)]}\'"';
const SCHEME_ANYWHERE = /\bhttps?:\/\//i;
const WWW_ANYWHERE = /\bwww\./i;
const BARE_DOMAIN = /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}\b/i;

function pushText(segments: TextSegment[], value: string): void {
  if (value === '') {
    return;
  }
  const last = segments[segments.length - 1];
  if (last !== undefined && last.type === 'text') {
    last.value += value;
    return;
  }
  segments.push({ type: 'text', value });
}

/**
 * Splits text into plain text and clickable https links; joining every segment's value gives the
 * text back, and an empty text gives no segment. http links and bare domains stay text.
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let position = 0;
  for (const match of text.matchAll(HTTPS_RUN)) {
    const run = match[0];
    const start = match.index;
    let end = run.length;
    while (end > 0 && TRAILING_PUNCTUATION.includes(run.charAt(end - 1))) {
      end -= 1;
    }
    const value = run.slice(0, end);
    const parsed = parseSafeUrl(value);
    if (parsed === null) {
      continue;
    }
    pushText(segments, text.slice(position, start));
    segments.push({ type: 'link', value, href: parsed.url, domain: parsed.domain });
    position = start + value.length;
  }
  pushText(segments, text.slice(position));
  return segments;
}

/** True when text holds a link or something that reads as one, an email address included. */
export function containsLink(text: string): boolean {
  return (
    linkify(text).some((segment) => segment.type === 'link') ||
    SCHEME_ANYWHERE.test(text) ||
    WWW_ANYWHERE.test(text) ||
    BARE_DOMAIN.test(text)
  );
}
