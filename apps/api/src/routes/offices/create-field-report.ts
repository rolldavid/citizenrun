import type { Handler } from 'hono';
import {
  ErrorEnvelopeSchema,
  FieldReportCreatedSchema,
  FieldReportInputSchema,
  OfficeIdParamsSchema,
} from '@citizenrun/shared';
import type { FieldReportInput, OfficeIdParams } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { createFieldReport } from '../../services/offices/field-reports.ts';

const ERROR_RESPONSE = { 'application/json': { schema: ErrorEnvelopeSchema } };

/** E-OFF-09 `POST /v1/offices/:id/field-reports`: a report of a mistake on the office page. */
export const createFieldReportRoute = defineRoute({
  method: 'post',
  path: '/offices/{id}/field-reports',
  operationId: 'createFieldReport',
  tags: ['offices'],
  request: {
    params: OfficeIdParamsSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: FieldReportInputSchema } },
    },
  },
  responses: {
    201: {
      description: 'The report is stored.',
      content: { 'application/json': { schema: FieldReportCreatedSchema } },
    },
    400: { description: 'The request is not valid.', content: ERROR_RESPONSE },
    401: { description: 'No valid session.', content: ERROR_RESPONSE },
    403: {
      description:
        'Onboarding is not finished, the request-forgery check failed, or the account is suspended.',
      content: ERROR_RESPONSE,
    },
    404: { description: 'No office has that id.', content: ERROR_RESPONSE },
    422: {
      description:
        'The office is retired, the account is under a day old, or the link is not a safe https link.',
      content: ERROR_RESPONSE,
    },
    429: {
      description: 'The daily report limit is reached, or too many requests.',
      content: ERROR_RESPONSE,
    },
  },
  meta: { auth: 'onboarded', rateLimit: 'field_report' },
  errors: [
    'invalid_request',
    'unauthenticated',
    'onboarding_incomplete',
    'origin_rejected',
    'account_suspended',
    'not_found',
    'office_retired',
    'account_too_new',
    'link_invalid',
    'daily_limit_reached',
    'rate_limited',
  ],
});

type CreateFieldReportInput = {
  in: { param: Record<string, string>; json: unknown };
  out: { param: OfficeIdParams; json: FieldReportInput };
};

/** The handler of E-OFF-09. The note and the link are never logged. */
export function createFieldReportHandler(
  deps: Deps,
): Handler<RouterEnv, string, CreateFieldReportInput> {
  return async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const viewer = c.get('viewer');
    if (viewer === null) {
      throw new Error('The middleware chain set no viewer.');
    }
    const now = deps.clock.now();
    const created = await createFieldReport(deps, { viewer, officeId: id, body, now });
    return respond(c, FieldReportCreatedSchema, created, 201);
  };
}
