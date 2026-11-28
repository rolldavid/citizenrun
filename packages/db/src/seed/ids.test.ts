import { describe, expect, it } from 'vitest';
import {
  SEED_AVATAR_UPLOAD_IDS,
  SEED_CONSENT_IDS,
  SEED_FIXED_AT,
  SEED_USER_IDS,
  seedId,
} from './ids.ts';

const AT = new Date('2027-03-05T22:00:00.000Z');
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('seedId', () => {
  it('seedId is deterministic and time-ordered', () => {
    const first = seedId('post', 1, AT);
    const second = seedId('post', 2, AT);
    expect(first).toBe('01a417b4-f700-7fd9-964f-5a5a8c94cc4b');
    expect(second).toBe('01a417b4-f700-7de1-9a43-fe5628346904');
    expect(seedId('post', 1, AT)).toBe(first);

    const later = seedId('post', 1, new Date(AT.getTime() + 1));
    for (const id of [first, second, later]) {
      expect(id).toMatch(UUID_V7);
    }
    expect([later, second, first].sort()).toEqual([first, second, later].sort());
    expect(later > first && later > second).toBe(true);
  });

  it('gives different kinds different random bits at the same time', () => {
    expect(seedId('comment', 1, AT)).not.toBe(seedId('post', 1, AT));
    expect(seedId('comment', 1, AT).slice(0, 13)).toBe(seedId('post', 1, AT).slice(0, 13));
  });

  it('refuses an invalid date and a negative or fractional ordinal', () => {
    expect(() => seedId('post', 1, new Date('not a date'))).toThrow(RangeError);
    expect(() => seedId('post', 1, new Date(-1))).toThrow(RangeError);
    expect(() => seedId('post', -1, AT)).toThrow(RangeError);
    expect(() => seedId('post', 1.5, AT)).toThrow(RangeError);
  });
});

// The admin counts as user 50 where a formula needs a number.
function ordinalOf(key: string): number {
  return key === 'admin' ? 50 : Number(key);
}

const CONSENT_KINDS = ['terms', 'content_policy', 'privacy_policy'] as const;

function allFixedIds(): string[] {
  return [
    ...Object.values(SEED_USER_IDS),
    ...Object.values(SEED_CONSENT_IDS).flatMap((ids) => Object.values(ids)),
    ...Object.values(SEED_AVATAR_UPLOAD_IDS),
  ];
}

describe('the fixed seed ids', () => {
  it('every fixed literal equals seedId of its kind and ordinal', () => {
    expect(SEED_FIXED_AT.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    const userKeys = [
      'admin',
      ...Array.from({ length: 49 }, (_, i) => String(i + 1).padStart(2, '0')),
    ];
    expect(Object.keys(SEED_USER_IDS).sort()).toEqual([...userKeys].sort());
    expect(Object.keys(SEED_CONSENT_IDS).sort()).toEqual([...userKeys].sort());
    expect(Object.keys(SEED_AVATAR_UPLOAD_IDS).sort()).toEqual(userKeys.slice(1, 31));

    for (const [key, id] of Object.entries(SEED_USER_IDS)) {
      expect(id, key).toBe(seedId('user', ordinalOf(key), SEED_FIXED_AT));
    }
    for (const [key, ids] of Object.entries(SEED_CONSENT_IDS)) {
      expect(Object.keys(ids)).toEqual([...CONSENT_KINDS]);
      for (const kind of CONSENT_KINDS) {
        expect(ids[kind], `${key} ${kind}`).toBe(
          seedId(`consent-${kind}`, ordinalOf(key), SEED_FIXED_AT),
        );
      }
    }
    for (const [key, id] of Object.entries(SEED_AVATAR_UPLOAD_IDS)) {
      expect(id, key).toBe(seedId('avatar-upload', ordinalOf(key), SEED_FIXED_AT));
    }
  });

  it('every fixed id is distinct and a version 7 uuid', () => {
    const ids = allFixedIds();
    expect(ids).toHaveLength(50 + 50 * 3 + 30);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(UUID_V7);
    }
  });
});
