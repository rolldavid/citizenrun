import { z } from 'zod';

// Every pattern below admits no space, so no free-text message can be sent (E-SAFE-02, PC3C-47).

/** One stack frame of a client error report: a file, a line and a column (E-SAFE-02). */
export const ClientErrorFrameSchema = z
  .object({
    file: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_\-/.@]+$/),
    line: z.number().int().min(0).max(10_000_000),
    column: z.number().int().min(0).max(10_000_000),
  })
  .meta({ id: 'ClientErrorFrame' });

export type ClientErrorFrame = z.infer<typeof ClientErrorFrameSchema>;

/**
 * The body of `POST /v1/client-errors` (E-SAFE-02): the fixed schema and nothing else.
 * Unknown keys are dropped.
 */
export const CreateClientErrorBodySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_$.]+$/),
    code: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
    route: z
      .string()
      .min(1)
      .max(200)
      .regex(/^\/[A-Za-z0-9_\-/[\]().+]*$/)
      .nullable(),
    component: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_$.]+$/)
      .nullable(),
    appVersion: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
    platform: z.enum(['ios', 'android', 'web']),
    frames: z.array(ClientErrorFrameSchema).max(20),
    requestId: z.uuid().nullable(),
  })
  .meta({ id: 'CreateClientErrorBody' });

export type CreateClientErrorBody = z.infer<typeof CreateClientErrorBodySchema>;
