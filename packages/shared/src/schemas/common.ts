import { z } from 'zod';
import { ConfidenceSchema } from '../bundle/common.ts';
import { SOURCE_URL_MAX } from '../policy/links.ts'; // L-links
import { ERROR_CODES, FIELD_CODES } from '../errors.ts';
import type { ErrorCode } from '../errors.ts';

/** One field-level code of an `invalid_request` error (ErrorEnvelope). */
export const FieldCodeSchema = z.enum(FIELD_CODES);

const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]; // Object.keys loses the key type; ERROR_CODES is a non-empty `as const` object

/** A code of the error-code registry (L-error-registry). */
export const ErrorCodeSchema = z.enum(ERROR_CODE_LIST);

/** The body of every non-2xx `/v1` response (ErrorEnvelope). */
export const ErrorEnvelopeSchema = z
  .object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string().max(200),
      fields: z.record(z.string().max(200), FieldCodeSchema),
    }),
  })
  .meta({ id: 'ErrorEnvelope' });

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/** A page of a list (`Page<T>`); `nextCursor` is null at the end and for a list that is never paged. */
export function pageSchema<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({ items: z.array(item), nextCursor: z.string().max(512).nullable() })
    .meta({ id });
}

export type Page<T> = { items: T[]; nextCursor: string | null };

/** An instant on the wire: ISO 8601 UTC with milliseconds and `Z`, as `toISOString()` writes it (L-wire-format). */
export const InstantSchema = z.iso.datetime({ precision: 3 });

/** A smaller rendition of a media object: its bucket key, signed URL and pixel size (Media, L-media-url). */
export const MediaVariantSchema = z
  .object({
    key: z.string(),
    url: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
  })
  .meta({ id: 'MediaVariant' });

export type MediaVariant = z.infer<typeof MediaVariantSchema>;

/** A photo or video as every response sends it, with signed URLs (Media, L-media-url, D-471). */
export const MediaSchema = z
  .object({
    kind: z.enum(['image', 'video']),
    key: z.string(),
    url: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    blurhash: z.string().nullable(),
    thumb: MediaVariantSchema.nullable(),
    poster: MediaVariantSchema.nullable(),
    durationMs: z.number().int().nullable(),
  })
  .meta({ id: 'Media' });

export type Media = z.infer<typeof MediaSchema>;

const ConfidenceComponent = ConfidenceSchema.meta({ id: 'Confidence' });

/** How sure a sourced value is: `low` is a template default or an estimate (D-073). */
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** The proof of one act-on value as the API sends it, inside an entity's `fieldMeta` (D-439). */
export type FieldMeta = {
  sourceUrl: string | null;
  quote: string | null;
  confidence: Confidence;
  checkedAt: string;
  ruleCitation: string | null;
};

/** `FieldMeta` on the wire: `sourceUrl` and `quote` may be null only at `low` confidence (D-439). */
export const FieldMetaSchema: z.ZodType<FieldMeta> = z
  .object({
    sourceUrl: z
      .string()
      .max(SOURCE_URL_MAX)
      .regex(/^https:\/\//)
      .nullable(),
    quote: z.string().max(2000).nullable(),
    confidence: ConfidenceComponent,
    checkedAt: InstantSchema,
    ruleCitation: z.string().max(500).nullable(),
  })
  .superRefine((meta, ctx) => {
    if (meta.confidence === 'low') {
      return;
    }
    for (const key of ['sourceUrl', 'quote'] as const) {
      if (meta[key] === null) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          params: { code: 'not_allowed' },
          message: 'High and medium confidence need a source and a quote.',
        });
      }
    }
  })
  .meta({ id: 'FieldMeta' });

/** The wire `fieldMeta` map, keyed by the camelCase field name; a null value has no entry (D-439). */
export const FieldMetaWireMapSchema = z
  .record(z.string(), FieldMetaSchema)
  .meta({ id: 'FieldMetaMap' });

export type FieldMetaWireMap = Record<string, FieldMeta>;

/** One value with its proof, as a view-model hands it to a component (D-439). */
export type Sourced<T> = { value: T | null; meta: FieldMeta | null };

/** The wire form of one sourced value, for a response whose contract says so. */
export function sourcedSchema<S extends z.ZodType>(value: S): z.ZodType<Sourced<z.infer<S>>> {
  // `.required()` states what zod cannot infer for a generic value schema: both keys are always sent.
  return z.object({ value: value.nullable(), meta: FieldMetaSchema.nullable() }).required();
}
