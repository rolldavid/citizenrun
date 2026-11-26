import { describe, expect, it } from 'vitest';

import * as handleFixtures from './handle.fixtures';
import * as issuesFixtures from './issues.fixtures';
import * as locationFixtures from './location.fixtures';
import * as photoFixtures from './photo.fixtures';

function namesOf(module: object): string[] {
  return Object.keys(module).sort();
}

describe('the onboarding fixtures', () => {
  it('photo fixtures are the states of the step', () => {
    expect(namesOf(photoFixtures)).toEqual(
      [
        'photoNone',
        'photoReady',
        'photoUploading',
        'photoFailedPhotosBlocked',
        'photoFailedUnsupportedFormat',
        'photoFailedPhotoTooLarge',
        'photoFailedPrepareFailed',
        'photoFailedUploadFailed',
        'photoFailedRateLimited',
        'photoFailedGeneric',
        'photoSkipping',
        'photoOffline',
      ].sort(),
    );
    expect(photoFixtures.photoUploading.photo).toMatchObject({
      sentBytes: 120_000,
      totalBytes: 480_000,
    });
    for (const fixture of [
      photoFixtures.photoFailedPhotosBlocked,
      photoFixtures.photoFailedUnsupportedFormat,
      photoFixtures.photoFailedPhotoTooLarge,
      photoFixtures.photoFailedPrepareFailed,
    ]) {
      expect(fixture.photo.previewUri).toBeNull();
    }
    for (const fixture of [
      photoFixtures.photoFailedUploadFailed,
      photoFixtures.photoFailedRateLimited,
      photoFixtures.photoFailedGeneric,
    ]) {
      expect(fixture.photo.previewUri).not.toBeNull();
    }
    expect(photoFixtures.photoOffline.offline).toBe(true);
    expect(photoFixtures.photoSkipping.skipStatus).toBe('sending');
  });

  it('handle fixtures', () => {
    expect(namesOf(handleFixtures)).toEqual(
      [
        'handleEmpty',
        'handleChecking',
        'handleFree',
        'handleTaken',
        'handleReserved',
        'handleTooShort',
        'handleTooLong',
        'handleCharacters',
        'handleDots',
        'handleNoLetter',
        'handleSending',
        'handleRace',
        'handleChangeTooSoon',
        'handleCheckFailed',
        'handleOffline',
      ].sort(),
    );
    expect(handleFixtures.handleChangeTooSoon).toMatchObject({
      initialHandle: 'test_fixture',
      submit: {
        errorCode: 'handle_change_too_soon',
        changeAvailableAt: '2027-02-14T12:00:00.000Z',
      },
    });
    expect(handleFixtures.handleRace.check).toBe('taken');
    expect(handleFixtures.handleCheckFailed.check).toBe('failed');
  });

  it('issues fixtures', () => {
    expect(namesOf(issuesFixtures)).toEqual(
      [
        'issuesLoading',
        'issuesError',
        'issuesOffline',
        'issuesNone',
        'issuesTwo',
        'issuesFive',
        'issuesTen',
        'issuesStarLimit',
        'issuesSending',
        'issuesSubmitError',
        'issuesTight',
      ].sort(),
    );
    expect(issuesFixtures.issuesError).toMatchObject({ status: 'error', code: 'unavailable' });
    const picks = (fixture: typeof issuesFixtures.issuesFive) =>
      fixture.status === 'ready' ? fixture.data.initial : null;
    expect(picks(issuesFixtures.issuesFive)).toEqual([
      { issueId: 'rent-housing', starred: true },
      { issueId: 'utility-bills', starred: false },
      { issueId: 'property-taxes', starred: false },
      { issueId: 'wages-workers', starred: false },
      { issueId: 'schools', starred: true },
    ]);
    expect(picks(issuesFixtures.issuesTen)?.filter((pick) => pick.starred)).toHaveLength(2);
    expect(picks(issuesFixtures.issuesTen)).toHaveLength(10);
    expect(picks(issuesFixtures.issuesStarLimit)?.filter((pick) => pick.starred)).toHaveLength(3);
    expect(picks(issuesFixtures.issuesStarLimit)).toHaveLength(5);
    expect(issuesFixtures.issuesTight).toEqual(issuesFixtures.issuesFive);
  });

  it('location fixtures', () => {
    expect(namesOf(locationFixtures)).toEqual(
      ['locationSoon', 'locationSoonSending', 'locationSoonError', 'locationSoonOffline'].sort(),
    );
    expect(locationFixtures.locationSoonError.errorCode).toBe('unavailable');
  });
});
