import { describe, expect, it } from 'vitest';

import * as aboutFixtures from './settings-about.fixtures';
import * as deleteFixtures from './settings-delete-account.fixtures';
import * as exportFixtures from './settings-export.fixtures';
import * as privacyFixtures from './settings-privacy.fixtures';

function namesOf(module: object): string[] {
  return Object.keys(module).sort();
}

function hoursBetween(from: string | null | undefined, to: string | null | undefined): number {
  return (Date.parse(to ?? '') - Date.parse(from ?? '')) / 3_600_000;
}

describe('the privacy and data fixtures', () => {
  it('privacy fixtures are the states of the screen', () => {
    expect(namesOf(privacyFixtures)).toEqual(
      [
        'privacyM1',
        'privacySaving',
        'privacySaveFailed',
        'privacyLoading',
        'privacyError',
        'privacyOffline',
        'privacyStale',
      ].sort(),
    );
    expect(privacyFixtures.privacyM1.data.me.consents.aiScreening).toBe('granted');
    expect(privacyFixtures.privacySaving.data.saving).toBe('aiScreening');
    expect(privacyFixtures.privacySaveFailed.data.errorCode).toBe('unavailable');
    expect(privacyFixtures.privacyStale.stale).toBe(true);
  });

  it('export fixtures are the states of the screen', () => {
    expect(namesOf(exportFixtures)).toEqual(
      [
        'exportNone',
        'exportQueued',
        'exportReady',
        'exportExpired',
        'exportFailed',
        'exportWait',
        'exportReauth',
        'exportLoading',
        'exportError',
        'exportOffline',
        'exportStale',
      ].sort(),
    );
    expect(exportFixtures.exportNone.data.status).toEqual({ export: null, nextRequestAt: null });
    expect(exportFixtures.exportQueued.data.status.export?.status).toBe('queued');
    const ready = exportFixtures.exportReady.data.status.export;
    expect(ready?.status).toBe('ready');
    expect(hoursBetween(ready?.readyAt, ready?.expiresAt)).toBe(24);
    expect(exportFixtures.exportExpired.data.status.export?.status).toBe('expired');
    expect(exportFixtures.exportFailed.data.status.export?.status).toBe('failed');
    const wait = exportFixtures.exportWait.data.status;
    expect(hoursBetween(wait.export?.requestedAt, wait.nextRequestAt)).toBe(24);
    expect(exportFixtures.exportReauth.data.reauth.open).toBe(true);
    expect(exportFixtures.exportNone.data.reauth).toMatchObject({
      open: false,
      appleButton: null,
      googleButton: null,
    });
    expect(exportFixtures.exportStale.stale).toBe(true);
  });

  it('deletion fixtures are the states of the screen', () => {
    expect(namesOf(deleteFixtures)).toEqual(
      [
        'deleteInfo',
        'deleteConfirm',
        'deleteReauth',
        'deleteDeleting',
        'deleteError',
        'deleteSuspended',
        'deleteDeleted',
        'deleteLoading',
        'deleteLoadError',
        'deleteOffline',
        'deleteStale',
      ].sort(),
    );
    expect(deleteFixtures.deleteInfo.data).toMatchObject({
      status: 'idle',
      exportHref: '/settings/export',
    });
    expect(deleteFixtures.deleteConfirm.data.status).toBe('confirming');
    expect(deleteFixtures.deleteReauth.data.reauth.open).toBe(true);
    expect(deleteFixtures.deleteDeleting.data.status).toBe('deleting');
    expect(deleteFixtures.deleteError.data.errorCode).toBe('unavailable');
    expect(deleteFixtures.deleteSuspended.data.me.status).toBe('suspended');
    expect(deleteFixtures.deleteSuspended.data.me.suspension).not.toBeNull();
    expect(deleteFixtures.deleteDeleted.data.status).toBe('deleted');
    expect(deleteFixtures.deleteLoadError.status).toBe('error');
    expect(deleteFixtures.deleteStale.stale).toBe(true);
  });

  it('about fixtures are the milestone form', () => {
    expect(namesOf(aboutFixtures)).toEqual(['aboutM1']);
    expect(aboutFixtures.aboutM1.sources).toEqual([]);
    expect(aboutFixtures.aboutM1.links.map((link) => link.id)).toEqual([
      'privacy',
      'terms',
      'contentPolicy',
    ]);
    for (const link of aboutFixtures.aboutM1.links) {
      expect(link.url.startsWith('https://example.test/')).toBe(true);
    }
  });
});
