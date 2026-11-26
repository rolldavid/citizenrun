import { describe, expect, it } from 'vitest';

import type { ViewState } from '@/lib/view-state';

import * as accountFixtures from './settings-account.fixtures';
import * as appearanceFixtures from './settings-appearance.fixtures';
import * as issuesFixtures from './settings-issues.fixtures';
import * as profileFixtures from './settings-profile.fixtures';
import * as settingsFixtures from './settings.fixtures';

function namesOf(module: object): string[] {
  return Object.keys(module).sort();
}

function dataOf<D>(view: ViewState<D>): D {
  if (view.status !== 'ready') throw new Error(`expected ready, got ${view.status}`);
  return view.data;
}

describe('the settings fixtures of the list, profile, issues, account and appearance', () => {
  it('settings list fixtures', () => {
    expect(namesOf(settingsFixtures)).toEqual(
      [
        'settingsDefault',
        'settingsSupport',
        'settingsLoggingOut',
        'settingsLoading',
        'settingsError',
        'settingsOffline',
        'settingsStale',
      ].sort(),
    );
    expect(dataOf(settingsFixtures.settingsDefault)).toMatchObject({
      supportEmail: null,
      onContactSupport: null,
    });
    expect(dataOf(settingsFixtures.settingsSupport).supportEmail).toBe('support@example.test');
    expect(dataOf(settingsFixtures.settingsSupport).onContactSupport).not.toBeNull();
    expect(dataOf(settingsFixtures.settingsLoggingOut).logoutStatus).toBe('sending');
    expect(settingsFixtures.settingsStale).toMatchObject({ status: 'ready', stale: true });
    expect(settingsFixtures.settingsError).toMatchObject({ status: 'error', code: 'internal' });
  });

  it('profile fixtures', () => {
    expect(namesOf(profileFixtures)).toEqual(
      [
        'profileEdit',
        'profileEditDirty',
        'profileEditSaving',
        'profileEditSaved',
        'profileEditFieldErrors',
        'profileEditHandleLocked',
        'profileEditAvatarPending',
        'profileEditAiConsent',
        'profileEditLoading',
        'profileEditError',
        'profileEditOffline',
        'profileEditStale',
      ].sort(),
    );
    expect(dataOf(profileFixtures.profileEditDirty).photo.status).toBe('ready');
    expect(dataOf(profileFixtures.profileEditFieldErrors).save.fields).toEqual({
      name: 'too_long',
      link: 'invalid_format',
    });
    expect(dataOf(profileFixtures.profileEditHandleLocked).me.handleChangeAvailableAt).toBe(
      '2027-02-14T12:00:00.000Z',
    );
    expect(dataOf(profileFixtures.profileEditAvatarPending).me).toMatchObject({
      avatarPending: true,
    });
    expect(dataOf(profileFixtures.profileEditAvatarPending).me.avatar).not.toBeNull();
    expect(dataOf(profileFixtures.profileEditAiConsent).aiConsentNeeded).toBe(true);
    expect(dataOf(profileFixtures.profileEditSaved).save.status).toBe('saved');
    expect(profileFixtures.profileEditStale).toEqual({
      ...profileFixtures.profileEdit,
      stale: true,
    });
  });

  it('issues fixtures', () => {
    expect(namesOf(issuesFixtures)).toEqual(
      [
        'settingsIssuesLoading',
        'settingsIssuesError',
        'settingsIssuesOffline',
        'settingsIssuesNone',
        'settingsIssuesStale',
        'settingsIssuesTwo',
        'settingsIssuesFive',
        'settingsIssuesTen',
        'settingsIssuesStarLimit',
        'settingsIssuesSending',
        'settingsIssuesSubmitError',
        'settingsIssuesTight',
        'settingsIssuesSaved',
      ].sort(),
    );
    expect(dataOf(issuesFixtures.settingsIssuesNone).issues).toHaveLength(19);
    expect(dataOf(issuesFixtures.settingsIssuesNone).initial).toEqual([]);
    expect(issuesFixtures.settingsIssuesStale).toEqual({
      ...issuesFixtures.settingsIssuesNone,
      stale: true,
    });
    expect(dataOf(issuesFixtures.settingsIssuesTen).initial).toHaveLength(10);
    expect(
      dataOf(issuesFixtures.settingsIssuesStarLimit).initial.filter((pick) => pick.starred),
    ).toHaveLength(3);
    expect(dataOf(issuesFixtures.settingsIssuesSaved).submit.status).toBe('saved');
    expect(issuesFixtures.settingsIssuesTight).toEqual(issuesFixtures.settingsIssuesFive);
  });

  it('account fixtures', () => {
    expect(namesOf(accountFixtures)).toEqual(
      [
        'accountWithEmail',
        'accountNoEmail',
        'accountEmailBounced',
        'accountAddEmailCode',
        'accountAddEmailInUse',
        'accountLoading',
        'accountError',
        'accountOffline',
        'accountStale',
      ].sort(),
    );
    expect(dataOf(accountFixtures.accountNoEmail).me).toMatchObject({
      email: null,
      signInMethods: ['apple'],
    });
    expect(dataOf(accountFixtures.accountEmailBounced).me.emailStatus).toBe('bounced');
    expect(dataOf(accountFixtures.accountAddEmailCode).addEmail.stage).toBe('code');
    expect(dataOf(accountFixtures.accountAddEmailCode).addEmail.code).not.toBeNull();
    expect(dataOf(accountFixtures.accountAddEmailInUse).addEmail).toMatchObject({
      stage: 'email',
      email: { errorCode: 'email_in_use' },
    });
  });

  it('appearance fixtures', () => {
    expect(namesOf(appearanceFixtures)).toEqual(['appearanceSystem', 'appearanceDark'].sort());
    expect(appearanceFixtures.appearanceDark.choice).toBe('dark');
  });
});
