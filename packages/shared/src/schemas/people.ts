import { z } from 'zod';

// The request schemas of the `people` area.

/** The path of `GET /v1/people/:idOrSlug` (E-PPL-01): a uuid or a slug (L-person-resolve). */
export const GetPersonParamsSchema = z
  .object({ idOrSlug: z.string().min(1).max(200) })
  .meta({ id: 'GetPersonParams' });

export type GetPersonParams = z.infer<typeof GetPersonParamsSchema>;
