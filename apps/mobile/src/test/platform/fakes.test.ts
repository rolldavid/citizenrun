import { focusManager, onlineManager } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import * as realAgeAssurance from '@/platform/age-assurance';
import * as realAuth from '@/platform/auth';
import * as realCalendar from '@/platform/calendar';
import * as realHaptics from '@/platform/haptics';
import * as realHead from '@/platform/head';
import * as realLinks from '@/platform/links';
import * as realLocation from '@/platform/location';
import * as realMap from '@/platform/map';
import * as realPdf from '@/platform/pdf';
import * as realPush from '@/platform/push';
import * as realQueryClient from '@/platform/query-client';
import * as realSession from '@/platform/session';
import * as realShare from '@/platform/share';
import * as realStorage from '@/platform/storage';
import * as realUpload from '@/platform/upload';
import * as realVideo from '@/platform/video';
import { PlatformError, PlatformNotReadyError } from '@/platform/shared';
import type { PickedPhoto } from '@/platform/upload/types';
import { resetPlatformFakes } from '@/test/platform';
import { ageAssurance, ageAssuranceFake } from '@/test/platform/age-assurance';
import { auth, authFake } from '@/test/platform/auth';
import { calendar, calendarFake } from '@/test/platform/calendar';
import { haptics, hapticsFake } from '@/test/platform/haptics';
import { head } from '@/test/platform/head';
import { links, linksFake } from '@/test/platform/links';
import { location, locationFake } from '@/test/platform/location';
import { map, mapFake } from '@/test/platform/map';
import { pdf, pdfFake } from '@/test/platform/pdf';
import { push, pushFake } from '@/test/platform/push';
import { queryClient, queryClientFake } from '@/test/platform/query-client';
import { session, sessionFake } from '@/test/platform/session';
import { share, shareFake } from '@/test/platform/share';
import { storage, storageFake } from '@/test/platform/storage';
import { upload, uploadFake } from '@/test/platform/upload';
import { video, videoFake } from '@/test/platform/video';

const PHOTO: PickedPhoto = {
  kind: 'photo',
  previewUri: 'file:///fixture/photo.jpg',
  width: 1200,
  height: 900,
  mimeType: 'image/jpeg',
  fileSize: 2048,
};

const FIXTURE_FORM = {
  name: 'Fixture Runner',
  address: null,
  office: null,
  district: null,
  election_date: null,
  party: null,
} as const;

describe('the platform fakes', () => {
  it('every platform import resolves to its fake', () => {
    expect(realSession.session).toBe(session);
    expect(realMap.map).toBe(map);
    expect(realUpload.upload).toBe(upload);
    expect(realPush.push).toBe(push);
    expect(realShare.share).toBe(share);
    expect(realLocation.location).toBe(location);
    expect(realHaptics.haptics).toBe(haptics);
    expect(realCalendar.calendar).toBe(calendar);
    expect(realAuth.auth).toBe(auth);
    expect(realPdf.pdf).toBe(pdf);
    expect(realVideo.video).toBe(video);
    expect(realStorage.storage).toBe(storage);
    expect(realLinks.links).toBe(links);
    expect(realAgeAssurance.ageAssurance).toBe(ageAssurance);
    expect(realQueryClient.queryClient).toBe(queryClient);
    expect(realHead.head).toBe(head);
  });

  it('resetPlatformFakes restores every default', async () => {
    // Change state on every control object and record at least one call on each.
    sessionFake.setClient({ platform: 'web', appVersion: '2.0.0', header: 'web/2.0.0' });
    sessionFake.setApiOrigin('');
    sessionFake.setCredential('cookie');
    session.configure({ onUnauthorized: () => undefined, onUpgradeRequired: () => undefined });

    hapticsFake.setSupported(false);
    haptics.selection();

    storageFake.seed({ theme: 'dark' });
    storageFake.failNextFlush();
    storage.set('reload.chunkReloaded', true);

    const firstClient = queryClient.get();
    queryClientFake.setOnline(false);
    queryClientFake.setFocused(false);
    queryClient.clear();

    linksFake.setStoreListingSupported(true);
    linksFake.scriptOpen('failed');
    linksFake.scriptFontsReady(false);
    links.subscribeKeyDown(() => undefined);
    expect(links.reloadOnce('chunk_error')).toBe(true);

    mapFake.scriptFeatures([
      { layerId: 'fixture', sourceId: 'fixture', id: 1, properties: {}, point: null, bounds: null },
    ]);

    video.controller.preload('fixture-1', { uri: 'https://example.test/v.mp4', cacheKey: 'k' });

    authFake.scriptAvailability({ apple: false, google: false });
    await auth.clearProviderState();

    ageAssuranceFake.scriptOutcome({ kind: 'unavailable' });
    ageAssuranceFake.setStoreSignalSupported(false);
    ageAssuranceFake.scriptAcknowledgmentRequired(true);
    ageAssurance.blockGate(new Date('2026-01-01T00:00:00Z'));

    uploadFake.scriptPick({ kind: 'failed', code: 'upload.picker_failed' });
    uploadFake.scriptPrepare({ kind: 'rejected', reason: 'photo_too_large' });
    upload.release([]);

    locationFake.scriptPermission('blocked');
    locationFake.scriptPosition({ kind: 'unavailable', code: 'location.timeout' });
    locationFake.setSupported(false);
    await location.getPermission();

    pushFake.scriptPermission('blocked');
    pushFake.scriptRegistration({ kind: 'unsupported' });
    pushFake.scriptLaunchData({ url: '/fixture', nid: null, t: 'fixture' });
    pushFake.setSupported(false);
    await push.register();

    shareFake.setCapabilities({ nativeSheetSupported: false, copySupported: true });
    shareFake.scriptOutcome('shareLink', 'failed');
    const prepared = await share.prepare({
      kind: 'link',
      url: 'https://example.test/p',
      title: 'Fixture',
    });

    calendarFake.setCapabilities({ oneTapSupported: false, updatesSupported: true });
    calendarFake.scriptPermission('denied');
    calendarFake.scriptAddOutcome({ kind: 'unsupported' });
    calendarFake.scriptSubscribeOutcome('failed');
    await calendar.removeDeclarationEvents('fixture-declaration');

    pdfFake.setRememberSupported(false);
    pdfFake.scriptOutput('failed');
    pdf.discard({ id: 'fixture', fileName: 'fixture.pdf', byteLength: 1 });

    const controls = [
      sessionFake,
      hapticsFake,
      storageFake,
      queryClientFake,
      linksFake,
      mapFake,
      videoFake,
      authFake,
      ageAssuranceFake,
      uploadFake,
      locationFake,
      pushFake,
      shareFake,
      calendarFake,
      pdfFake,
    ];
    // The map records only through a rendered surface's handle (fakes.test.tsx).
    for (const control of controls.filter((c) => c !== mapFake)) {
      expect(control.calls.length).toBeGreaterThan(0);
    }

    resetPlatformFakes();

    for (const control of controls) {
      expect(control.calls).toEqual([]);
    }

    expect(session.credential).toBe('bearer');
    expect(session.client).toEqual({ platform: 'ios', appVersion: '1.0.0', header: 'ios/1.0.0' });
    expect(session.apiOrigin).toBe('http://api.test');
    expect(sessionFake.lastCallbacks()).toBeNull();

    expect(haptics.supported).toBe(true);

    expect(storage.get('theme')).toBeNull();
    expect(storage.get('reload.chunkReloaded')).toBeNull();
    await expect(storage.flush()).resolves.toBeUndefined();

    expect(queryClient.get()).not.toBe(firstClient);
    expect(onlineManager.isOnline()).toBe(true);
    expect(focusManager.isFocused()).toBe(true); // undefined focus falls back to the document's state

    expect(links.storeListingSupported).toBe(false);
    await expect(links.openExternal('https://example.test/')).resolves.toBe('opened');
    await expect(links.fontsReady([])).resolves.toBe(true);
    expect(links.reloadOnce('chunk_error')).toBe(true);

    expect(mapFake.lastProps()).toBeNull();

    expect(video.controller.getActiveId()).toBeNull();

    await expect(auth.prepare()).resolves.toEqual({ apple: true, google: true });

    expect(ageAssurance.storeSignalSupported).toBe(true);
    await expect(ageAssurance.requestStoreSignal()).resolves.toEqual({
      kind: 'adult',
      tier: 'declared',
    });
    await expect(ageAssurance.significantUpdateAcknowledgmentRequired()).resolves.toBe(false);
    expect(ageAssurance.gateBlockedUntil()).toBeNull();

    await expect(upload.pickAvatarPhoto()).resolves.toEqual({ kind: 'cancelled' });
    await expect(upload.preparePhoto(PHOTO, { crop: null })).resolves.toMatchObject({
      kind: 'ready',
      file: { kind: 'photo', contentType: 'image/jpeg', size: 2048 },
    });

    expect(location.supported).toBe(true);
    await expect(location.getPermission()).resolves.toBe('granted');
    await expect(location.getCurrentPosition()).resolves.toEqual({
      kind: 'position',
      lat: 0,
      lng: 0,
      precision: 'exact',
    });

    expect(push.supported).toBe(true);
    await expect(push.getPermission()).resolves.toBe('undetermined');
    await expect(push.takeLaunchData()).resolves.toBeNull();
    await expect(push.register()).resolves.toMatchObject({ kind: 'registered' });

    expect(share.nativeSheetSupported).toBe(true);
    expect(share.copySupported).toBe(false);
    await expect(share.shareLink(prepared)).resolves.toBe('shared');
    await expect(share.prepare(prepared.request)).resolves.toMatchObject({ id: 'share-1' });

    expect(calendar.oneTapSupported).toBe(true);
    expect(calendar.updatesSupported).toBe(false);
    await expect(calendar.getPermission()).resolves.toBe('granted');
    await expect(calendar.addEvents([], 'Fixture')).resolves.toEqual({
      kind: 'done',
      added: 0,
      updated: 0,
      unchanged: 0,
    });
    await expect(calendar.openSubscribeLink('https://example.test/feed.ics')).resolves.toBe(
      'opened',
    );

    expect(pdf.rememberSupported).toBe(true);
    await expect(
      pdf.output({ id: 'fixture', fileName: 'fixture.pdf', byteLength: 1 }, 'preview'),
    ).resolves.toBe('done');
  });

  it('fakes record no secret', async () => {
    pushFake.scriptPermission('granted');
    await push.register();
    await push.getToken();
    expect(JSON.stringify(pushFake.calls)).not.toContain('ExponentPushToken');
    expect(pushFake.calls).toEqual([{ op: 'register' }, { op: 'getToken' }]);

    await links.openMail('help@example.test');
    expect(JSON.stringify(linksFake.calls)).not.toContain('example.test');
    expect(linksFake.calls).toEqual([{ op: 'openMail' }]);

    await calendar.openSubscribeLink('webcal://example.test/t/abc.ics');
    expect(JSON.stringify(calendarFake.calls)).not.toContain('abc');
    expect(calendarFake.calls).toEqual([{ op: 'openSubscribeLink', scheme: 'webcal' }]);

    storage.set('theme', 'dark');
    expect(JSON.stringify(storageFake.calls)).not.toContain('dark');
    expect(storageFake.calls).toEqual([{ op: 'set', key: 'theme' }]);

    await pdf.remember(FIXTURE_FORM);
    expect(JSON.stringify(pdfFake.calls)).not.toContain('Fixture Runner');
    expect(pdfFake.calls).toEqual([{ op: 'remember', sources: ['name'] }]);

    await location.getCurrentPosition();
    expect(locationFake.calls).toEqual([{ op: 'getCurrentPosition' }]);

    await upload.preparePhoto(PHOTO, { crop: null });
    expect(JSON.stringify(uploadFake.calls)).not.toContain('fixture/photo');
  });

  it('the storage fake applies the key rules', async () => {
    storageFake.seed({ theme: 'sepia' as never }); // an invalid value, which the key's rule must refuse
    expect(storage.get('theme')).toBeNull();

    storageFake.seed({ theme: 'dark' });
    storage.clearUserData();
    expect(storage.get('theme')).toBe('dark');
    expect(storageFake.calls).toEqual([{ op: 'clearUserData' }]);

    storageFake.failNextFlush();
    const failed = storage.flush();
    await expect(failed).rejects.toBeInstanceOf(PlatformError);
    await expect(failed).rejects.toMatchObject({ code: 'storage.write_failed' });
    await expect(storage.flush()).resolves.toBeUndefined();
  });

  it('the links fake reloads once per reason', () => {
    expect(links.reloadOnce('chunk_error')).toBe(true);
    expect(links.reloadOnce('chunk_error')).toBe(false);
    expect(links.reloadOnce('upgrade_required')).toBe(true);

    linksFake.scriptReloadOnce('upgrade_required', [true]);
    expect(links.reloadOnce('upgrade_required')).toBe(true);
    expect(links.reloadOnce('upgrade_required')).toBe(false);
    expect(linksFake.calls).toHaveLength(5);
  });

  it('the query client fake is fresh per test', () => {
    const first = queryClient.get();
    queryClientFake.reset();
    const second = queryClient.get();
    queryClientFake.reset();
    const third = queryClient.get();

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    expect(third.getDefaultOptions().queries?.retry).toBe(false);
    expect(third.getDefaultOptions().mutations?.retry).toBe(false);
    expect(third.getDefaultOptions().queries?.gcTime).toBe(Infinity);
  });

  it('the push fake answers the default permission path', async () => {
    await expect(push.getToken()).resolves.toBeNull();
    await expect(push.requestPermission()).resolves.toBe('granted');
    await expect(push.getToken()).resolves.toBe('ExponentPushToken[fake]');

    pushFake.scriptPermission('blocked');
    await expect(push.requestPermission()).resolves.toBe('blocked');
  });

  it('the age assurance fake keeps its own gate lock', () => {
    ageAssurance.blockGate(new Date('2026-03-01T12:00:00.000Z'));
    expect(ageAssurance.gateBlockedUntil()).toBe('2026-03-02T12:00:00.000Z');
    expect(() => ageAssurance.evaluateBirthMonth({ year: 2000, month: 1 }, '2026-03-01')).toThrow(
      PlatformNotReadyError,
    );
  });
});
