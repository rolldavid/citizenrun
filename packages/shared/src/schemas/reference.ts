import { z } from 'zod';

/** The OpenAPI 3.1 document E-REF-03 serves: the document itself, keyed as the standard gives it. */
export const OpenApiDocumentSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: 'OpenApiDocument' });

export type OpenApiDocument = z.infer<typeof OpenApiDocumentSchema>;
