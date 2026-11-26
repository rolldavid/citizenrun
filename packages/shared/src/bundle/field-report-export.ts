import { z } from 'zod';
import { IsoInstantSchema, SafeUrlSchema, SlugSchema } from './common.ts';

/** One open field report in an export file; strict, so a user id or a message is refused. */
export const FieldReportExportRowSchema = z.strictObject({
  report_id: z.uuid(),
  office_slug: SlugSchema,
  field: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .nullable(),
  source_url: SafeUrlSchema.nullable(),
  created_at: IsoInstantSchema,
}); // no user id and no message text
export type FieldReportExportRow = z.infer<typeof FieldReportExportRowSchema>;
