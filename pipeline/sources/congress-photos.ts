// Portraits of members of Congress (D-314): step 1, the unitedstates/images repository of GPO
// portraits (CC0); step 2, the Congress.gov API portrait, only with the api.data.gov key
// (OI-datagov-key). The key travels only in the X-Api-Key header, never in a URL, a log or an error.
import { SafeUrlSchema, kebab } from '@citizenrun/shared';
import { z } from 'zod';
import type { RunContext } from '../lib/runner.ts';
import { CC0_URL } from './wikimedia.ts';
import type { PhotoRecordBase, PhotoRejectReason } from './wikimedia.ts';

export const SOURCE_IDS = ['congress-portraits', 'congress-gov-api'] as const;

const BIOGUIDE = /^[A-Z]\d{6}$/;
const STEP1_AUTHOR = 'U.S. Government Publishing Office';
const STEP2_LICENSE_URL = 'https://www.law.cornell.edu/uscode/text/17/105';
/** A Congress.gov attribution naming a federal body (P8-25). */
export const FEDERAL_ATTRIBUTION =
  /Senate|House|Congress|Government Publishing Office|Library of Congress/i;

/** A found image: the body already in `cache/raw/` (step 1), or the URL still to fetch (step 2). */
export type CongressPhoto =
  | { readonly ok: true; readonly cacheKey: string; readonly record: PhotoRecordBase }
  | { readonly ok: true; readonly imageUrl: string; readonly record: PhotoRecordBase }
  | { readonly ok: false; readonly reason: PhotoRejectReason };

/** A request that gave no body: the day's cap, a 404 or 410 (no such file), or a failure. */
function failure(result: { kind: string; reason?: string; status?: number | null }): {
  ok: false;
  reason: PhotoRejectReason;
} {
  if (result.kind === 'disallowed' && result.reason === 'daily_cap') {
    return { ok: false, reason: 'daily_cap' };
  }
  if (result.kind === 'error' && (result.status === 404 || result.status === 410)) {
    return { ok: false, reason: 'missing' };
  }
  return { ok: false, reason: 'fetch_failed' };
}

/** The step 1 URL of a member's portrait. */
export function portraitUrl(bioguide: string): string {
  return `https://unitedstates.github.io/images/congress/450x550/${bioguide}.jpg`;
}

/** The record step 1 gives every portrait. */
export function step1Record(bioguide: string): PhotoRecordBase {
  return {
    source_url: portraitUrl(bioguide),
    author: STEP1_AUTHOR,
    license: 'CC0-1.0',
    license_url: CC0_URL,
    credit_text: `${STEP1_AUTHOR} · CC0`,
    modified: false,
  };
}

/** Step 1: the GPO portrait. A 404 or any answer other than an image goes on to step 2. */
export async function portraitStep1(ctx: RunContext, bioguide: string): Promise<CongressPhoto> {
  if (!BIOGUIDE.test(bioguide)) {
    return { ok: false, reason: 'fetch_failed' };
  }
  const result = await ctx.fetcher.fetch({ url: portraitUrl(bioguide), class: 'dataset' });
  if (result.kind !== 'ok') {
    return failure(result);
  }
  if (!/^image\//i.test(result.contentType ?? '')) {
    return { ok: false, reason: 'mime' };
  }
  return { ok: true, cacheKey: result.cacheKey, record: step1Record(bioguide) };
}

const MemberSchema = z.object({
  member: z.object({
    directOrderName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    depiction: z
      .object({ imageUrl: z.string().optional(), attribution: z.string().nullable().optional() })
      .nullable()
      .optional(),
  }),
});

/** The Congress.gov member page of `bioguide`, named by the member's full name. */
export function memberPageUrl(fullName: string, bioguide: string): string {
  return `https://www.congress.gov/member/${kebab(fullName)}/${bioguide}`;
}

/** Step 2: the Congress.gov portrait, accepted when its attribution is absent or names a federal body. */
export async function congressGovStep2(
  ctx: RunContext,
  bioguide: string,
  key: string,
): Promise<CongressPhoto> {
  if (!BIOGUIDE.test(bioguide)) {
    return { ok: false, reason: 'fetch_failed' };
  }
  const result = await ctx.fetcher.fetch({
    url: `https://api.congress.gov/v3/member/${bioguide}?format=json`,
    class: 'api',
    headers: { 'X-Api-Key': key },
  });
  if (result.kind !== 'ok') {
    return failure(result);
  }
  const bytes = await ctx.bucket.getBytes(result.cacheKey);
  let parsed: z.infer<typeof MemberSchema> | null = null;
  if (bytes !== null) {
    try {
      const outcome = MemberSchema.safeParse(JSON.parse(Buffer.from(bytes).toString('utf8')));
      parsed = outcome.success ? outcome.data : null;
    } catch {
      parsed = null;
    }
  }
  const member = parsed?.member;
  const imageUrl = member?.depiction?.imageUrl ?? null;
  if (member === undefined || imageUrl === null || !SafeUrlSchema.safeParse(imageUrl).success) {
    return { ok: false, reason: 'missing' };
  }
  const attribution = member.depiction?.attribution?.replace(/\s+/g, ' ').trim() ?? '';
  if (attribution !== '' && !FEDERAL_ATTRIBUTION.test(attribution)) {
    return { ok: false, reason: 'attribution' };
  }
  const fullName =
    member.directOrderName?.trim() ||
    [member.firstName, member.lastName]
      .filter((part) => part !== undefined && part.trim() !== '')
      .join(' ');
  if (fullName === '' || kebab(fullName) === '') {
    return { ok: false, reason: 'no_source_url' };
  }
  const author = attribution === '' ? 'Congress.gov' : attribution;
  if (author.length > 300) {
    return { ok: false, reason: 'artist_too_long' };
  }
  return {
    ok: true,
    imageUrl,
    record: {
      source_url: memberPageUrl(fullName, bioguide),
      author,
      license: 'LicenseRef-PD-USGov',
      license_url: STEP2_LICENSE_URL,
      credit_text: `${author} · Public domain`,
      modified: false,
    },
  };
}
