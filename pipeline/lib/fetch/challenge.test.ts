import { describe, expect, it } from 'vitest';
import { CHALLENGE_MARKERS, isChallenge } from './challenge.ts';

describe('isChallenge', () => {
  it('each marker with 403, 429 and 503', () => {
    for (const marker of CHALLENGE_MARKERS) {
      for (const status of [403, 429, 503]) {
        expect(isChallenge(status, `<html><body>${marker}</body></html>`)).toBe(true);
      }
    }
  });

  it('Access Denied with Reference #', () => {
    expect(isChallenge(403, 'Access Denied ... Reference #18.abc')).toBe(true);
    expect(isChallenge(403, 'Access Denied')).toBe(false);
    expect(isChallenge(403, 'Reference #18.abc')).toBe(false);
  });

  it('a 200 with a marker is not a challenge', () => {
    expect(isChallenge(200, 'Just a moment...')).toBe(false);
  });

  it('a 404 is not', () => {
    expect(isChallenge(404, 'cf-chl')).toBe(false);
  });

  it('a marker after the first 64 KiB is not seen', () => {
    expect(isChallenge(403, `${' '.repeat(65_536)}cf-chl`)).toBe(false);
  });
});
