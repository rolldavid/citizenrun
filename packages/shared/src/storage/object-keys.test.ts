import { describe, expect, it } from 'vitest';
import type { UploadContentType } from '../constants/uploads.ts';
import {
  avatarKeys,
  avatarUploadPrefix,
  avatarUserPrefix,
  civicFormKey,
  civicPhotoKey,
  exportKey,
  exportUserPrefix,
  incomingUploadKey,
  incomingUserPrefix,
  uploadIdOfAvatarKey,
} from './object-keys.ts';

const USER = '0195a7e0-0000-7000-8000-000000000001';
const UPLOAD = '0195a7e0-0000-7000-8000-000000000002';
const EXPORT = '0195a7e0-0000-7000-8000-000000000003';

describe('L-object-keys', () => {
  it("incoming keys use the type's extension", () => {
    const cases: [UploadContentType, string][] = [
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['video/mp4', 'mp4'],
      ['video/quicktime', 'mov'],
      ['video/webm', 'webm'],
    ];
    for (const [contentType, extension] of cases) {
      expect(incomingUploadKey(USER, UPLOAD, contentType)).toBe(
        `incoming/${USER}/${UPLOAD}.${extension}`,
      );
    }
    expect(incomingUserPrefix(USER)).toBe(`incoming/${USER}/`);
  });

  it('avatar keys are a 320 and a 1080 JPEG under the upload', () => {
    expect(avatarKeys(USER, UPLOAD)).toEqual({
      small: `avatars/${USER}/${UPLOAD}/320.jpg`,
      large: `avatars/${USER}/${UPLOAD}/1080.jpg`,
    });
    expect(avatarUploadPrefix(USER, UPLOAD)).toBe(`avatars/${USER}/${UPLOAD}/`);
    expect(avatarUserPrefix(USER)).toBe(`avatars/${USER}/`);
    const { small, large } = avatarKeys(USER, UPLOAD);
    expect(small.startsWith(avatarUploadPrefix(USER, UPLOAD))).toBe(true);
    expect(large.startsWith(avatarUserPrefix(USER))).toBe(true);
  });

  it('uploadIdOfAvatarKey reads the third segment', () => {
    const { small, large } = avatarKeys(USER, UPLOAD);
    expect(uploadIdOfAvatarKey(small)).toBe(UPLOAD);
    expect(uploadIdOfAvatarKey(large)).toBe(UPLOAD);
    const others = [
      `posts/${USER}/${UPLOAD}/320.jpg`,
      `avatars/${USER}/x/320.jpg`,
      `avatars/${USER}/${UPLOAD}/640.jpg`,
      `incoming/${USER}/${UPLOAD}.jpg`,
      `avatars/${USER}/${UPLOAD}/320.jpg/extra`,
      `x/avatars/${USER}/${UPLOAD}/320.jpg`,
      `avatars/not-a-user/${UPLOAD}/320.jpg`,
      `avatars/${USER}/${UPLOAD.toUpperCase()}/320.jpg`,
      `avatars/${USER}/${UPLOAD}/320xjpg`,
      '',
    ];
    for (const key of others) {
      expect(uploadIdOfAvatarKey(key)).toBeNull();
    }
  });

  it('export keys', () => {
    expect(exportKey(USER, EXPORT)).toBe(`exports/${USER}/${EXPORT}.json`);
    expect(exportUserPrefix(USER)).toBe(`exports/${USER}/`);
    for (const prefix of [
      exportUserPrefix(USER),
      incomingUserPrefix(USER),
      avatarUserPrefix(USER),
      avatarUploadPrefix(USER, UPLOAD),
    ]) {
      expect(prefix.endsWith('/')).toBe(true);
    }
  });

  it('ids must be lower-case uuids', () => {
    const upper = USER.toUpperCase();
    const bad = [upper, '../x', '', `${USER}/`, `${USER} `];
    for (const id of bad) {
      expect(() => incomingUploadKey(id, UPLOAD, 'image/jpeg')).toThrow(RangeError);
      expect(() => incomingUploadKey(USER, id, 'image/jpeg')).toThrow(RangeError);
      expect(() => incomingUserPrefix(id)).toThrow(RangeError);
      expect(() => avatarKeys(id, UPLOAD)).toThrow(RangeError);
      expect(() => avatarKeys(USER, id)).toThrow(RangeError);
      expect(() => avatarUploadPrefix(USER, id)).toThrow(RangeError);
      expect(() => avatarUserPrefix(id)).toThrow(RangeError);
      expect(() => exportKey(id, EXPORT)).toThrow(RangeError);
      expect(() => exportKey(USER, id)).toThrow(RangeError);
      expect(() => exportUserPrefix(id)).toThrow(RangeError);
    }
    const heic = 'image/heic' as UploadContentType; // a caller outside the type, as untyped input would be
    expect(() => incomingUploadKey(USER, UPLOAD, heic)).toThrow(RangeError);
    const inherited = 'toString' as UploadContentType; // an Object.prototype name is not a content type
    expect(() => incomingUploadKey(USER, UPLOAD, inherited)).toThrow(RangeError);
  });

  it('a civic photo key is its content hash', () => {
    const sha = 'ab'.repeat(32);
    expect(civicPhotoKey(sha)).toBe(`civic/photos/${sha}.jpg`);
    expect(() => civicPhotoKey('ABC')).toThrow(RangeError);
  });

  it('a civic form key is its content hash', () => {
    const sha = '0f'.repeat(32);
    expect(civicFormKey(sha)).toBe(`civic/forms/${sha}.pdf`);
    expect(() => civicFormKey('ABC')).toThrow(RangeError);
  });
});
