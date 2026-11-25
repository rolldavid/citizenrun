import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, InstantSchema, MediaSchema, pageSchema } from './common.ts';

describe('ErrorEnvelopeSchema', () => {
  it('the envelope accepts a registry code', () => {
    const result = ErrorEnvelopeSchema.safeParse({
      error: { code: 'not_found', message: 'Not found.', fields: {} },
    });
    expect(result.success).toBe(true);
  });

  it('the envelope refuses an unknown code', () => {
    const result = ErrorEnvelopeSchema.safeParse({
      error: { code: 'nope', message: 'Not found.', fields: {} },
    });
    expect(result.success).toBe(false);
  });

  it('the envelope keeps field codes', () => {
    const kept = ErrorEnvelopeSchema.safeParse({
      error: {
        code: 'invalid_request',
        message: 'The request is not valid.',
        fields: { 'issues.2.issueId': 'required' },
      },
    });
    expect(kept.success).toBe(true);
    expect(kept.data?.error.fields).toEqual({ 'issues.2.issueId': 'required' });

    const refused = ErrorEnvelopeSchema.safeParse({
      error: {
        code: 'invalid_request',
        message: 'The request is not valid.',
        fields: { a: 'weird' },
      },
    });
    expect(refused.success).toBe(false);
  });

  it('the envelope refuses a message over 200 characters', () => {
    const result = ErrorEnvelopeSchema.safeParse({
      error: { code: 'internal', message: 'x'.repeat(201), fields: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe('pageSchema', () => {
  const TestPageSchema = pageSchema(z.string(), 'CommonTestStringPage');

  it('pageSchema keeps nextCursor nullable', () => {
    expect(TestPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(TestPageSchema.safeParse({ items: ['a'], nextCursor: 'abc' }).success).toBe(true);
    expect(TestPageSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('pageSchema refuses a cursor over 512 characters', () => {
    expect(TestPageSchema.safeParse({ items: [], nextCursor: 'c'.repeat(513) }).success).toBe(
      false,
    );
  });

  it('pageSchema gives the page its component id', () => {
    expect(z.globalRegistry.get(TestPageSchema)?.id).toBe('CommonTestStringPage');
  });
});

describe('MediaSchema', () => {
  const avatar = {
    kind: 'image',
    key: 'avatars/0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60/0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f61/320.jpg',
    url: 'http://127.0.0.1:9000/media/fixture-avatar.jpg',
    width: 320,
    height: 320,
    blurhash: null,
    thumb: null,
    poster: null,
    durationMs: null,
  };

  it('an avatar media parses', () => {
    const result = MediaSchema.safeParse(avatar);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(avatar);
  });

  it('a media object with a key missing fails', () => {
    for (const missing of Object.keys(avatar)) {
      const partial = Object.fromEntries(Object.entries(avatar).filter(([key]) => key !== missing));
      expect(MediaSchema.safeParse(partial).success).toBe(false);
    }
  });

  it('a video carries its poster and duration', () => {
    const video = {
      ...avatar,
      kind: 'video',
      width: 1280,
      height: 720,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      thumb: {
        key: 'thumb.jpg',
        url: 'http://127.0.0.1:9000/media/thumb.jpg',
        width: 320,
        height: 180,
      },
      poster: {
        key: 'poster.jpg',
        url: 'http://127.0.0.1:9000/media/poster.jpg',
        width: 1080,
        height: 608,
      },
      durationMs: 12_500,
    };
    expect(MediaSchema.safeParse(video).success).toBe(true);
    expect(MediaSchema.safeParse({ ...video, kind: 'audio' }).success).toBe(false);
  });

  it('gives Media its component id', () => {
    expect(MediaSchema.meta()?.id).toBe('Media');
  });
});

describe('InstantSchema', () => {
  it('an instant with milliseconds and Z parses', () => {
    expect(InstantSchema.safeParse(new Date(0).toISOString()).success).toBe(true);
    expect(InstantSchema.safeParse('2027-03-05T22:00:00.000Z').success).toBe(true);
  });

  it('an instant without milliseconds fails', () => {
    expect(InstantSchema.safeParse('2027-03-05T22:00:00Z').success).toBe(false);
  });

  it('an instant with an offset or a date alone fails', () => {
    expect(InstantSchema.safeParse('2027-03-05T22:00:00.000+01:00').success).toBe(false);
    expect(InstantSchema.safeParse('2027-03-05').success).toBe(false);
  });
});
