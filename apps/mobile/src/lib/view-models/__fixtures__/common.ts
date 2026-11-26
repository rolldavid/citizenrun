import { LEGAL_VERSIONS } from '@citizenrun/shared';
import type { Media, Me, SessionInfo } from '@citizenrun/shared';

export const noop = (): void => {};

const PHOTO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">' +
  '<rect width="320" height="320" fill="#4f6d8f"/>' +
  '<rect y="160" width="320" height="160" fill="#c9d6e3"/>' +
  '</svg>';

/** A 320 by 320 two-tone square as an SVG data URI; no person, no real photo. */
export const FIXTURE_PHOTO_URI = `data:image/svg+xml;utf8,${encodeURIComponent(PHOTO_SVG)}`;

export const FIXTURE_USER_ID = '01890000-0000-7000-8000-000000000001';

export function fixtureMe(overrides: Partial<Me> = {}): Me {
  return {
    id: FIXTURE_USER_ID,
    handle: 'test_fixture',
    name: 'Fixture Person',
    bio: null,
    link: null,
    avatar: null,
    avatarPending: false,
    email: 'fixture@example.test',
    emailStatus: 'ok',
    signInMethods: ['email'],
    role: 'user',
    status: 'active',
    suspension: null,
    onboardingStep: 'done',
    onboardedAt: '2027-01-15T12:00:00.000Z',
    createdAt: '2027-01-15T11:59:00.000Z',
    newAccountUntil: '2027-01-22T11:59:00.000Z',
    handleChangeAvailableAt: null,
    issues: [],
    locale: 'en',
    age: { method: 'self_declared', sourceTier: 'self', checkedAt: '2027-01-15T11:59:00.000Z' },
    consents: {
      terms: { agreedVersion: LEGAL_VERSIONS.terms, currentVersion: LEGAL_VERSIONS.terms },
      contentPolicy: {
        agreedVersion: LEGAL_VERSIONS.content_policy,
        currentVersion: LEGAL_VERSIONS.content_policy,
      },
      privacyPolicy: {
        agreedVersion: LEGAL_VERSIONS.privacy_policy,
        currentVersion: LEGAL_VERSIONS.privacy_policy,
      },
      aiScreening: 'granted',
      needed: [],
    },
    session: {
      platform: 'ios',
      authenticatedAt: '2027-01-15T12:00:00.000Z',
      expiresAt: '2027-04-15T12:00:00.000Z',
      sensitiveActionsUntil: '2027-01-15T12:15:00.000Z',
    },
    location: {
      isSet: false,
      precision: null,
      districtCount: 0,
      bbox: null,
      placeName: null,
      officeCount: 0,
      needsConfirmation: false,
    },
    ...overrides,
  };
}

// 03a 2.1, the avatar form
export function fixtureAvatar(): Media {
  return {
    kind: 'image',
    key: `avatars/${FIXTURE_USER_ID}/01890000-0000-7000-8000-0000000000aa/320.jpg`,
    url: FIXTURE_PHOTO_URI,
    width: 320,
    height: 320,
    blurhash: null,
    thumb: null,
    poster: null,
    durationMs: null,
  };
}

export function fixtureSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    token: 'f'.repeat(43),
    expiresAt: '2027-04-15T12:00:00.000Z',
    created: false,
    me: fixtureMe(),
    ...overrides,
  };
}
