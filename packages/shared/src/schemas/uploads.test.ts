import type { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { CreateUploadBodySchema, UploadTicketSchema } from './uploads.ts';

const AVATAR = { kind: 'photo', purpose: 'avatar', contentType: 'image/jpeg', size: 500_000 };

function fieldIssues(result: z.ZodSafeParseResult<unknown>) {
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    params: 'params' in issue ? issue.params : undefined,
  }));
}

describe('CreateUploadBody', () => {
  it('an avatar photo body parses', () => {
    expect(CreateUploadBodySchema.parse({ ...AVATAR, extra: true })).toEqual(AVATAR);
    for (const contentType of ['image/png', 'image/webp']) {
      expect(CreateUploadBodySchema.safeParse({ ...AVATAR, contentType }).success).toBe(true);
    }
  });

  it('a video for an avatar fails with not_allowed at kind', () => {
    const result = CreateUploadBodySchema.safeParse({
      ...AVATAR,
      kind: 'video',
      contentType: 'video/mp4',
    });
    expect(fieldIssues(result)).toEqual([
      { path: 'kind', code: 'custom', params: { code: 'not_allowed' } },
    ]);
  });

  it('image/heic fails', () => {
    expect(
      fieldIssues(CreateUploadBodySchema.safeParse({ ...AVATAR, contentType: 'image/heic' })),
    ).toEqual([{ path: 'contentType', code: 'invalid_value', params: undefined }]);
  });

  it('image/png with kind video fails with invalid_value at contentType', () => {
    const result = CreateUploadBodySchema.safeParse({
      ...AVATAR,
      kind: 'video',
      contentType: 'image/png',
    });
    expect(fieldIssues(result)).toEqual([
      { path: 'contentType', code: 'custom', params: { code: 'invalid_value' } },
      { path: 'kind', code: 'custom', params: { code: 'not_allowed' } },
    ]);
  });

  it('a photo with a video type fails with invalid_value at contentType', () => {
    expect(
      fieldIssues(CreateUploadBodySchema.safeParse({ ...AVATAR, contentType: 'video/webm' })),
    ).toEqual([{ path: 'contentType', code: 'custom', params: { code: 'invalid_value' } }]);
  });

  it('purpose post fails', () => {
    expect(fieldIssues(CreateUploadBodySchema.safeParse({ ...AVATAR, purpose: 'post' }))).toEqual([
      { path: 'purpose', code: 'invalid_value', params: undefined },
    ]);
  });

  it('size 0 fails', () => {
    expect(fieldIssues(CreateUploadBodySchema.safeParse({ ...AVATAR, size: 0 }))).toEqual([
      { path: 'size', code: 'too_small', params: undefined },
    ]);
    expect(CreateUploadBodySchema.safeParse({ ...AVATAR, size: 1 }).success).toBe(true);
    expect(CreateUploadBodySchema.safeParse({ ...AVATAR, size: 1.5 }).success).toBe(false);
    expect(
      CreateUploadBodySchema.safeParse({ ...AVATAR, size: Number.MAX_SAFE_INTEGER }).success,
    ).toBe(true);
    expect(
      CreateUploadBodySchema.safeParse({ ...AVATAR, size: Number.MAX_SAFE_INTEGER + 1 }).success,
    ).toBe(false);
  });

  it('gives the body its component id', () => {
    expect(CreateUploadBodySchema.meta()?.id).toBe('CreateUploadBody');
  });
});

describe('UploadTicket', () => {
  it('a POST ticket parses with empty headers', () => {
    const ticket = {
      uploadId: '0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f61',
      key: 'incoming/0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60/0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f61.jpg',
      method: 'POST',
      url: 'http://127.0.0.1:9000/media',
      fields: {
        'Content-Type': 'image/jpeg',
        key: 'incoming/fixture.jpg',
        Policy: 'fixture-policy',
      },
      headers: {},
      maxBytes: 8_388_608,
      expiresAt: '2027-01-15T10:05:00.000Z',
    };
    expect(UploadTicketSchema.parse(ticket)).toEqual(ticket);
    expect(UploadTicketSchema.safeParse({ ...ticket, method: 'PATCH' }).success).toBe(false);
    expect(UploadTicketSchema.meta()?.id).toBe('UploadTicket');
  });
});
