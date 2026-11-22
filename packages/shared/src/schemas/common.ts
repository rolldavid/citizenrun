import { z } from 'zod';
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
