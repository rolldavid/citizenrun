import { z } from 'zod';
import { pageSchema } from './common.ts';

/** The OpenAPI 3.1 document E-REF-03 serves: the document itself, keyed as the standard gives it. */
export const OpenApiDocumentSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: 'OpenApiDocument' });

export type OpenApiDocument = z.infer<typeof OpenApiDocumentSchema>;

/** One issue of the reference list; its colors are design tokens reached by id and never sent (D-528). */
export const IssueSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.string(),
    sort: z.number().int(),
  })
  .meta({ id: 'Issue' });

export type Issue = z.infer<typeof IssueSchema>;

/** Every issue in sort order, never paged (E-REF-01). */
export const IssuePageSchema = pageSchema(IssueSchema, 'IssuePage');

export type IssuePage = z.infer<typeof IssuePageSchema>;
