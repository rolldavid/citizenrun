// Challenge pages (D-326): a host that answers one is blocked, never worked around (D-087).

export const CHALLENGE_MARKERS = [
  'cf-chl',
  'challenge-platform',
  'Just a moment...',
  'Attention Required! | Cloudflare',
  '_Incapsula_Resource',
] as const;

/** How much of a body the marker scan reads. */
export const CHALLENGE_SCAN_CHARS = 65_536;

const CHALLENGE_STATUSES: ReadonlySet<number> = new Set([403, 429, 503]);

/** True for a 403, 429 or 503 whose first 64 KiB holds a challenge marker. */
export function isChallenge(status: number, bodyText: string): boolean {
  if (!CHALLENGE_STATUSES.has(status)) {
    return false;
  }
  const head = bodyText.slice(0, CHALLENGE_SCAN_CHARS);
  if (CHALLENGE_MARKERS.some((marker) => head.includes(marker))) {
    return true;
  }
  return head.includes('Access Denied') && head.includes('Reference #');
}
