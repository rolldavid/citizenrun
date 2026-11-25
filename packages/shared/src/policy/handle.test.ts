import { describe, expect, it } from 'vitest';
import { BRAND } from '../brand.ts';
import {
  BRAND_HANDLE_WORDS,
  HANDLE_CHANGE_DAYS,
  HANDLE_HOLD_DAYS,
  HANDLE_MAX,
  HANDLE_MIN,
  RESERVED_HANDLE_WORDS,
  ROLE_HANDLE_WORDS,
  ROUTE_HANDLE_WORDS,
  canChangeHandle,
  validateHandle,
} from './handle.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// The route and role words of L-handle-rules, written out again so a word dropped from the module fails.
const EXPECTED_ROUTE_WORDS = [
  'welcome',
  'signin',
  'sign_in',
  'signup',
  'sign_up',
  'login',
  'logout',
  'onboarding',
  'explore',
  'create',
  'activity',
  'profile',
  'messages',
  'requests',
  'office',
  'offices',
  'c',
  'u',
  'p',
  'm',
  'og',
  'v1',
  'api',
  'map',
  'tiles',
  'search',
  'feed',
  'settings',
  'notifications',
  'calendar',
  'declarations',
  'people',
  'users',
  'posts',
  'comments',
  'uploads',
  'me',
  'privacy',
  'terms',
  'content_policy',
  'child_safety',
  'delete_account',
  'dmca',
  'report_intimate_image',
  'credits',
  'sitemap',
  'robots',
  'healthz',
  'readyz',
  'well_known',
  'go',
  'www',
  'mail',
  'staging',
  'about',
  'account',
  'accounts',
  'app',
  'assets',
  'auth',
  'bookmarks',
  'candidate',
  'candidates',
  'coverage',
  'delete',
  'dev',
  'follow',
  'followers',
  'following',
  'home',
  'inbox',
  'maps',
  'message',
  'person',
  'post',
  'register',
  'report',
  'run',
  'running',
  'static',
  'status',
  'user',
];
const EXPECTED_ROLE_WORDS = [
  'administrator',
  'admins',
  'root',
  'moderator',
  'moderators',
  'mod',
  'mods',
  'staff',
  'team',
  'official',
  'officials',
  'help',
  'security',
  'system',
  'sysadmin',
  'owner',
  'verified',
  'null',
  'undefined',
  'anonymous',
  'everyone',
  'nobody',
  'election',
  'elections',
  'election_office',
  'abuse',
  'apple',
  'contact',
  'fec',
  'google',
  'gov',
  'government',
  'helpdesk',
  'info',
  'legal',
  'ncmec',
  'news',
  'press',
  'safety',
  'secretaryofstate',
  'support',
  'trust',
  'admin',
];

function expectOk(input: string, handle: string): void {
  expect(validateHandle(input)).toEqual({ ok: true, handle });
}

function expectError(input: string, error: string): void {
  expect(validateHandle(input)).toEqual({ ok: false, error });
}

describe('validateHandle fixture rows', () => {
  it('@Jane_Doe', () => {
    expectOk('@Jane_Doe', 'jane_doe');
  });
  it('jd', () => {
    expectError('jd', 'too_short');
  });
  it('a_very_long_handle_123', () => {
    expectError('a_very_long_handle_123', 'too_long');
  });
  it('jane-doe', () => {
    expectError('jane-doe', 'invalid_characters');
  });
  it('.jane', () => {
    expectError('.jane', 'edge_dot');
  });
  it('jane..doe', () => {
    expectError('jane..doe', 'double_dot');
  });
  it('___', () => {
    expectError('___', 'no_letter_or_digit');
  });
  it('Ad.Min', () => {
    expectError('Ad.Min', 'reserved');
  });
  it('settings_', () => {
    expectError('settings_', 'reserved');
  });
  it('council_watch.27', () => {
    expectOk('council_watch.27', 'council_watch.27');
  });
  it('admin1', () => {
    expectError('admin1', 'reserved');
  });
  it('x<brand slug>x', () => {
    expectError(`x${BRAND.slug}x`, 'reserved');
  });
  it('mods_2', () => {
    expectError('mods_2', 'reserved');
  });
});

describe('validateHandle', () => {
  it('too short', () => {
    expect(HANDLE_MIN).toBe(3);
    expectError('ab', 'too_short');
  });

  it('shortest allowed', () => {
    expectOk('abc', 'abc');
  });

  it('longest allowed', () => {
    expect(HANDLE_MAX).toBe(20);
    const handle = 'a_b.c9'.repeat(4).slice(0, 20);
    expect(handle).toHaveLength(20);
    expectOk(handle, handle);
  });

  it('too long', () => {
    const handle = 'a_b.c9'.repeat(4).slice(0, 21);
    expect(handle).toHaveLength(21);
    expectError(handle, 'too_long');
  });

  it('allowed characters only', () => {
    for (const input of ['a-b', 'a b', 'ä_b', 'a@b']) {
      expectError(input, 'invalid_characters');
    }
  });

  it('upper case is lowered', () => {
    expectOk('Seed_User', 'seed_user');
  });

  it('trims and drops one leading @ only', () => {
    expectOk('  @abc  ', 'abc');
    expectError('@@abc', 'invalid_characters');
  });

  it('counts length in code points', () => {
    // Three astral characters are six UTF-16 units but three code points: long enough, then refused by character.
    expectError('\u{1F600}\u{1F600}\u{1F600}', 'invalid_characters');
    expectError('\u{1F600}\u{1F600}', 'too_short');
  });

  it('refuses a trailing dot', () => {
    expectError('jane.', 'edge_dot');
  });
});

describe('reserved words', () => {
  it('holds the three word classes of L-handle-rules', () => {
    expect([...ROUTE_HANDLE_WORDS]).toEqual(EXPECTED_ROUTE_WORDS);
    expect([...ROLE_HANDLE_WORDS]).toEqual(EXPECTED_ROLE_WORDS);
    expect(ROLE_HANDLE_WORDS).toContain('admin');
    expect(ROLE_HANDLE_WORDS).toContain('support');
    expect(ROUTE_HANDLE_WORDS).not.toContain('admin');
    expect(ROUTE_HANDLE_WORDS).not.toContain('support');
    const union = new Set([...EXPECTED_ROUTE_WORDS, ...EXPECTED_ROLE_WORDS, ...BRAND_HANDLE_WORDS]);
    expect(RESERVED_HANDLE_WORDS).toEqual(union);
  });

  const classes: ReadonlyArray<[string, readonly string[]]> = [
    ['route', ROUTE_HANDLE_WORDS],
    ['role', ROLE_HANDLE_WORDS],
    ['brand', BRAND_HANDLE_WORDS],
  ];
  for (const [name, words] of classes) {
    it(`every ${name} word is refused`, () => {
      for (const word of words) {
        const length = Array.from(word).length;
        const expected =
          length < HANDLE_MIN ? 'too_short' : length > HANDLE_MAX ? 'too_long' : 'reserved';
        expect(validateHandle(word), word).toEqual({ ok: false, error: expected });
      }
    });
  }

  it('words outside the length rule are refused by length first', () => {
    for (const word of ['c', 'u', 'p', 'm', 'og', 'v1', 'me', 'go']) {
      expectError(word, 'too_short');
    }
    expectError('report_intimate_image', 'too_long');
  });

  it('separators do not get a word through', () => {
    for (const input of [
      'sign_in',
      'signin',
      'sign.in',
      's.i.g.n.i.n',
      'set_tings',
      'elect.ion_office',
    ]) {
      expectError(input, 'reserved');
    }
  });

  it('admin42 is refused', () => {
    expectError('admin42', 'reserved');
  });

  it('support_42 is refused', () => {
    expectError('support_42', 'reserved');
  });

  it('teamwork is allowed', () => {
    expectOk('teamwork', 'teamwork');
  });

  it('a route word followed by digits is allowed', () => {
    expectOk('settings2', 'settings2');
  });

  it('a handle containing the brand slug is refused', () => {
    expectError(`the_${BRAND.slug}_fan`, 'reserved');
    expectError(`${BRAND.slug.slice(0, 4)}.${BRAND.slug.slice(4)}99`, 'reserved');
  });
});

describe('canChangeHandle', () => {
  const changedAt = new Date('2027-01-31T12:00:00.000Z');

  it('once every 30 days', () => {
    expect(HANDLE_CHANGE_DAYS).toBe(30);
    const almost = new Date(changedAt.getTime() + 29 * DAY_MS + 23 * HOUR_MS + 59 * MINUTE_MS);
    const exactly = new Date(changedAt.getTime() + 30 * DAY_MS);
    expect(canChangeHandle(changedAt, almost)).toBe(false);
    expect(canChangeHandle(changedAt, exactly)).toBe(true);
    expect(canChangeHandle(null, changedAt)).toBe(true);
  });

  it('holds a released handle for 90 days', () => {
    expect(HANDLE_HOLD_DAYS).toBe(90);
  });
});

describe('brand words', () => {
  it('the brand words come from the brand module', () => {
    expect(RESERVED_HANDLE_WORDS.has(BRAND.displayName.toLowerCase())).toBe(true);
    expect(RESERVED_HANDLE_WORDS.has(BRAND.slug)).toBe(true);
    for (const variant of Object.values(BRAND.variants)) {
      expect(RESERVED_HANDLE_WORDS.has(variant.scheme.replace(/-/g, ''))).toBe(true);
      expect(RESERVED_HANDLE_WORDS.has(variant.displayName.toLowerCase().replace(/ /g, ''))).toBe(
        true,
      );
    }
    for (const suffix of ['official', 'team', 'support', 'help', 'app']) {
      expect(RESERVED_HANDLE_WORDS.has(`${BRAND.displayName.toLowerCase()}${suffix}`)).toBe(true);
    }
  });
});
