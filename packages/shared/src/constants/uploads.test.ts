import { describe, expect, it } from 'vitest';
import {
  AVATAR_UPLOADS_PER_DAY,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  UPLOAD_EXTENSIONS,
  UPLOAD_POLICY_TTL_S,
  VIDEO_CONTENT_TYPES,
  VIDEO_MAX_BYTES_PHONE,
  VIDEO_MAX_BYTES_WEB,
} from './uploads.ts';

describe('upload constants', () => {
  it('the two type lists make the six allowed types', () => {
    expect([...PHOTO_CONTENT_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect([...VIDEO_CONTENT_TYPES]).toEqual(['video/mp4', 'video/quicktime', 'video/webm']);
    expect(new Set([...PHOTO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES]).size).toBe(6);
  });

  it('every allowed type has one extension', () => {
    expect(UPLOAD_EXTENSIONS).toEqual({
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    });
    expect(Object.keys(UPLOAD_EXTENSIONS).sort()).toEqual(
      [...PHOTO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES].sort(),
    );
  });

  it('sizes are binary megabytes', () => {
    expect(PHOTO_MAX_BYTES).toBe(8_388_608);
    expect(VIDEO_MAX_BYTES_PHONE).toBe(62_914_560);
    expect(VIDEO_MAX_BYTES_WEB).toBe(262_144_000);
  });

  it('the policy lives 300 seconds and an avatar has 20 tickets a day', () => {
    expect(UPLOAD_POLICY_TTL_S).toBe(300);
    expect(AVATAR_UPLOADS_PER_DAY).toBe(20);
  });
});
