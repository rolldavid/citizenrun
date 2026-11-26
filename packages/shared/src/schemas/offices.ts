import { z } from 'zod';
import { ISSUE_IDS } from '../design/issues.ts';
import { CandidacyViewSchema } from './civic.ts';
import { pageSchema } from './common.ts';

// The request and response schemas of the `offices` area.

/** The path of `GET /v1/offices/:idOrSlug` (E-OFF-01): a uuid or a slug, resolved by the service. */
export const GetOfficeParamsSchema = z
  .object({ idOrSlug: z.string().min(1).max(200) })
  .meta({ id: 'GetOfficeParams' });

export type GetOfficeParams = z.infer<typeof GetOfficeParamsSchema>;

/** The query of E-OFF-01: the issue of single-issue mode. */
export const GetOfficeQuerySchema = z
  .object({ issue: z.enum(ISSUE_IDS).optional() })
  .meta({ id: 'GetOfficeQuery' });

export type GetOfficeQuery = z.infer<typeof GetOfficeQuerySchema>;

/** The path of every office route that takes an office id. */
export const OfficeIdParamsSchema = z.object({ id: z.uuid() }).meta({ id: 'OfficeIdParams' });

export type OfficeIdParams = z.infer<typeof OfficeIdParamsSchema>;

/** The query of `GET /v1/offices/:id/candidates` (E-OFF-02). */
export const ListOfficeCandidatesQuerySchema = z
  .object({
    electionId: z.uuid().optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .meta({ id: 'ListOfficeCandidatesQuery' });

export type ListOfficeCandidatesQuery = z.infer<typeof ListOfficeCandidatesQuerySchema>;

/** A page of an office's candidacies (E-OFF-02). */
export const CandidacyViewPageSchema = pageSchema(CandidacyViewSchema, 'CandidacyViewPage');

export type CandidacyViewPage = z.infer<typeof CandidacyViewPageSchema>;

/** The answer of follow and unfollow (E-OFF-04, E-OFF-05). */
export const OfficeFollowStateSchema = z
  .object({ following: z.boolean() })
  .meta({ id: 'OfficeFollowState' });

export type OfficeFollowState = z.infer<typeof OfficeFollowStateSchema>;

/** The answer of bookmark and unbookmark (E-OFF-06, E-OFF-07). */
export const OfficeBookmarkStateSchema = z
  .object({ bookmarked: z.boolean() })
  .meta({ id: 'OfficeBookmarkState' });

export type OfficeBookmarkState = z.infer<typeof OfficeBookmarkStateSchema>;

/** The answer of a stored field report (E-OFF-09). */
export const FieldReportCreatedSchema = z
  .object({ id: z.uuid() })
  .meta({ id: 'FieldReportCreated' });

export type FieldReportCreated = z.infer<typeof FieldReportCreatedSchema>;
