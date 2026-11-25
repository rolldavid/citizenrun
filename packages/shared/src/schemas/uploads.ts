import { z } from 'zod';
import { PHOTO_CONTENT_TYPES, VIDEO_CONTENT_TYPES } from '../constants/uploads.ts';
import type { UploadContentType } from '../constants/uploads.ts';
import { InstantSchema } from './common.ts';

/** Where and how a client sends one upload: the signed form or headers and the size limit (UploadTicket). */
export const UploadTicketSchema = z
  .object({
    uploadId: z.uuid(),
    key: z.string(),
    method: z.enum(['POST', 'PUT']),
    url: z.string(),
    fields: z.record(z.string(), z.string()),
    headers: z.record(z.string(), z.string()),
    maxBytes: z.number().int(),
    expiresAt: InstantSchema,
  })
  .meta({ id: 'UploadTicket' });

export type UploadTicket = z.infer<typeof UploadTicketSchema>;

// The purpose enum gains each value in the release that adds it; until then the schema refuses it (L-upload-policy).
const UPLOAD_PURPOSES = ['avatar'] as const;

type UploadKind = 'photo' | 'video';

// The kinds each purpose allows (L-upload-policy).
const PURPOSE_KINDS: Readonly<Record<(typeof UPLOAD_PURPOSES)[number], readonly UploadKind[]>> = {
  avatar: ['photo'],
};

const PHOTO_TYPES: ReadonlySet<UploadContentType> = new Set(PHOTO_CONTENT_TYPES);

/** The body of `POST /v1/uploads` (E-UPL-01); unknown keys are dropped. */
export const CreateUploadBodySchema = z
  .object({
    kind: z.enum(['photo', 'video']),
    purpose: z.enum(UPLOAD_PURPOSES),
    contentType: z.enum([...PHOTO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES]),
    size: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((body, ctx) => {
    if ((body.kind === 'photo') !== PHOTO_TYPES.has(body.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        params: { code: 'invalid_value' },
        message: 'The content type does not match the kind.',
      });
    }
    if (!PURPOSE_KINDS[body.purpose].includes(body.kind)) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        params: { code: 'not_allowed' },
        message: 'The purpose does not allow this kind.',
      });
    }
  })
  .meta({ id: 'CreateUploadBody' });

export type CreateUploadBody = z.infer<typeof CreateUploadBodySchema>;
