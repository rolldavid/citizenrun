import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '@citizenrun/shared';

/** The public crawl policy, relative to the repository root; the user agent links to it (D-331). */
export const CRAWL_POLICY_PATH = 'docs/crawl-policy.md';

export type FetcherRefusal = 'crawl_policy_missing' | 'repository_unset';

/** The fetcher will not start: its user agent would point at a page that does not exist. */
export class FetcherRefusedError extends Error {
  override readonly name = 'FetcherRefusedError';
  readonly reason: FetcherRefusal;

  constructor(reason: FetcherRefusal) {
    super(reason);
    this.reason = reason;
  }
}

/** The repository the policy is published in; null until the brand module names one. */
function repository(): string | null {
  return BRAND.github.repository;
}

/** The robots.txt product token, built from the brand module. */
export function productToken(): string {
  return `${BRAND.displayName}Bot`;
}

/** The user agent of every request the pipeline makes (D-331). */
export function userAgent(version: string): string {
  return `${productToken()}/${version} (+https://github.com/${repository() ?? ''}/blob/main/${CRAWL_POLICY_PATH})`;
}

/** Why the fetcher may not start from `repoRoot` with this repository name, or null when it may. */
export function fetcherRefusal(repoRoot: string, repository: string | null): FetcherRefusal | null {
  if (repository === null) {
    return 'repository_unset';
  }
  if (!existsSync(join(repoRoot, CRAWL_POLICY_PATH))) {
    return 'crawl_policy_missing';
  }
  return null;
}

/** Throws FetcherRefusedError while the policy file is missing or the repository is unset. */
export function assertFetcherMayStart(repoRoot: string): void {
  const refusal = fetcherRefusal(repoRoot, repository());
  if (refusal !== null) {
    throw new FetcherRefusedError(refusal);
  }
}
