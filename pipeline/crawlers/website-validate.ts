// The yearly check of each unit's listed web address (D-310): one crawl-class request
// through the fetcher; a valid site is an https page that answers 200 with HTML.
import { SOURCE_URL_MAX, SafeUrlSchema, parseSafeUrl } from '@citizenrun/shared';
import { BucketKeyError, bucketKeys } from '../lib/bucket.ts';
import { ForbiddenHostError } from '../lib/fetch/fetcher.ts';
import type { Fetcher } from '../lib/fetch/types.ts';

export const SOURCE_IDS = ['unit-websites'] as const;

export type WebsiteVerdict =
  { kind: 'valid'; website: string } | { kind: 'invalid' } | { kind: 'unchecked'; reason: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** A scheme with no `//`, such as `mailto:`; a host and port such as `example.gov:8080` is not one. */
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
const HTML = /^(text\/html|application\/xhtml\+xml)\b/i;

/**
 * True when the fetch layer can name the host: it keys each host's robots record by the host name
 * and refuses one its key rule does not admit (a comma, an underscore, a trailing dot, an empty
 * label or one that starts or ends with a hyphen), so such a host is never requested.
 */
function fetchableHost(host: string): boolean {
  try {
    bucketKeys.robots(host);
    return true;
  } catch (error) {
    if (error instanceof BucketKeyError) {
      return false;
    }
    throw error;
  }
}

/**
 * The address as a URL to request: `https://` is put in front when it names no scheme. Null when
 * it is not an http or https address with a host the fetch layer can name.
 */
export function websiteRequestUrl(webAddress: string): string | null {
  const trimmed = webAddress.trim();
  if (
    trimmed === '' ||
    /\s/.test(trimmed) ||
    (!SCHEME.test(trimmed) && OTHER_SCHEME.test(trimmed))
  ) {
    return null;
  }
  const withScheme = SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.username !== '' || url.password !== '') {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return fetchableHost(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Requests the unit's site. Valid when the answer is 200 with an HTML type and the final URL passes
 * the safe-link check (https only); the website is the final URL's origin plus path. A refusal by
 * the crawl policy (business hours, the daily cap, robots, a blocked or forbidden host) or a
 * challenge is no verdict. An address whose host the fetch layer cannot name is invalid without a
 * request, and so is a site that redirects to such a host: one unit's address never fails the state.
 */
export async function validateWebsite(
  fetcher: Fetcher,
  webAddress: string,
  state: string,
): Promise<WebsiteVerdict> {
  const url = websiteRequestUrl(webAddress);
  if (url === null) {
    return { kind: 'invalid' };
  }
  let result;
  try {
    result = await fetcher.fetch({ url, class: 'crawl', state });
  } catch (error) {
    if (error instanceof ForbiddenHostError) {
      return { kind: 'unchecked', reason: 'forbidden_host' };
    }
    if (error instanceof BucketKeyError) {
      return { kind: 'invalid' };
    }
    throw error;
  }
  switch (result.kind) {
    case 'disallowed':
      return result.reason === 'not_https'
        ? { kind: 'invalid' }
        : { kind: 'unchecked', reason: result.reason };
    case 'challenge':
      return { kind: 'unchecked', reason: 'challenge' };
    case 'error':
    case 'not_modified':
      return { kind: 'invalid' };
    case 'ok': {
      if (result.status !== 200 || !HTML.test(result.contentType ?? '')) {
        return { kind: 'invalid' };
      }
      if (parseSafeUrl(result.finalUrl, SOURCE_URL_MAX) === null) {
        return { kind: 'invalid' };
      }
      const final = new URL(result.finalUrl);
      const website = `${final.origin}${final.pathname}`;
      return SafeUrlSchema.safeParse(website).success
        ? { kind: 'valid', website }
        : { kind: 'invalid' };
    }
  }
}

export type WebsiteOutcome = {
  /** The website the unit's row carries. */
  readonly website: string | null;
  /** The coverage counter the unit adds to. */
  readonly counter: 'units_website_valid' | 'website_invalid' | 'website_unchecked';
  /** True when the website is the state's last good output's, kept because there was no verdict. */
  readonly kept: boolean;
};

/**
 * What a verdict writes: a valid site its website, an invalid one null; with no verdict the unit
 * keeps the website of the state's last good output, or null when it had none.
 */
export function websiteOutcome(verdict: WebsiteVerdict, previous: string | null): WebsiteOutcome {
  switch (verdict.kind) {
    case 'valid':
      return { website: verdict.website, counter: 'units_website_valid', kept: false };
    case 'invalid':
      return { website: null, counter: 'website_invalid', kept: false };
    case 'unchecked':
      return { website: previous, counter: 'website_unchecked', kept: previous !== null };
  }
}
