import { describe, expect, it } from 'vitest';

import { fixtureMe } from '@/lib/view-models/__fixtures__/common';

import { profileChanges } from './profile-changes';
import type { ProfileInput } from './profile-changes';

const ME = fixtureMe({
  handle: 'test_fixture',
  name: 'Fixture Person',
  bio: 'Fixture bio.',
  link: 'https://example.test/me',
});

const SAME: ProfileInput = {
  name: 'Fixture Person',
  bio: 'Fixture bio.',
  link: 'https://example.test/me',
  handle: 'test_fixture',
};

describe('profileChanges', () => {
  it('sends nothing when nothing changed', () => {
    expect(profileChanges(ME, SAME)).toStrictEqual({ body: null, handle: null });
    expect(profileChanges(ME, { ...SAME, name: '  Fixture Person ' })).toStrictEqual({
      body: null,
      handle: null,
    });
  });

  it('sends a changed name trimmed', () => {
    expect(profileChanges(ME, { ...SAME, name: '  Fixture Renamed  ' })).toStrictEqual({
      body: { name: 'Fixture Renamed' },
      handle: null,
    });
  });

  it('clears a field emptied to spaces', () => {
    const changes = profileChanges(ME, { ...SAME, bio: '   ', link: null });
    expect(changes).toStrictEqual({ body: { bio: null, link: null }, handle: null });
    expect(Object.keys(changes.body ?? {})).toEqual(['bio', 'link']);
  });

  it('leaves a field that was empty and stays empty out of the body', () => {
    const empty = fixtureMe({ name: null, bio: null, link: null });
    expect(
      profileChanges(empty, { name: ' ', bio: '', link: null, handle: 'test_fixture' }),
    ).toStrictEqual({ body: null, handle: null });
  });

  it('sends a new valid handle normalised', () => {
    expect(profileChanges(ME, { ...SAME, handle: 'Test_Fixture2' })).toStrictEqual({
      body: null,
      handle: 'test_fixture2',
    });
  });

  it('sends an invalid handle as typed for the server to refuse', () => {
    expect(profileChanges(ME, { ...SAME, handle: 'ab' })).toStrictEqual({
      body: null,
      handle: 'ab',
    });
  });

  it("ignores the person's own handle typed again", () => {
    expect(profileChanges(ME, { ...SAME, handle: 'Test_Fixture' })).toStrictEqual({
      body: null,
      handle: null,
    });
  });

  it('sends the text fields and the handle together', () => {
    expect(
      profileChanges(ME, { ...SAME, name: 'Fixture Renamed', handle: 'test_fixture2' }),
    ).toStrictEqual({ body: { name: 'Fixture Renamed' }, handle: 'test_fixture2' });
  });
});
