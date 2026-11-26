import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Deps } from '../../deps.ts';
import { registerRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv, RouteContext } from '../../router.ts';
import { checkHandleHandler, checkHandleRoute } from './check-handle.ts';
import { clearLocationHandler, clearLocationRoute } from './clear-location.ts';
import { deleteMeHandler, deleteMeRoute } from './delete-me.ts';
import { getExportDownloadHandler, getExportDownloadRoute } from './get-export-download.ts';
import { getExportHandler, getExportRoute } from './get-export.ts';
import { getMeHandler, getMeRoute } from './get-me.ts';
import { recordAgeSignalHandler, recordAgeSignalRoute } from './record-age-signal.ts';
import { recordConsentHandler, recordConsentRoute } from './record-consent.ts';
import { requestExportHandler, requestExportRoute } from './request-export.ts';
import { setHandleHandler, setHandleRoute } from './set-handle.ts';
import { setIssuesHandler, setIssuesRoute } from './set-issues.ts';
import { setLocationHandler, setLocationRoute } from './set-location.ts';
import { skipOnboardingStepHandler, skipOnboardingStepRoute } from './skip-onboarding-step.ts';
import { updateMeHandler, updateMeRoute } from './update-me.ts';

/** Attaches the account routes (E-ME) to the `/v1` router. Registration reads nothing from `deps`. */
export function registerMeRoutes(
  router: OpenAPIHono<RouterEnv>,
  deps: Deps,
  ctx: RouteContext,
): void {
  registerRoute(router, getMeRoute, getMeHandler(deps), ctx);
  registerRoute(router, updateMeRoute, updateMeHandler(deps), ctx);
  registerRoute(router, checkHandleRoute, checkHandleHandler(deps), ctx);
  registerRoute(router, setHandleRoute, setHandleHandler(deps), ctx);
  registerRoute(router, setIssuesRoute, setIssuesHandler(deps), ctx);
  registerRoute(router, skipOnboardingStepRoute, skipOnboardingStepHandler(deps), ctx);
  registerRoute(router, deleteMeRoute, deleteMeHandler(deps), ctx);
  registerRoute(router, requestExportRoute, requestExportHandler(deps), ctx);
  registerRoute(router, getExportRoute, getExportHandler(deps), ctx);
  registerRoute(router, getExportDownloadRoute, getExportDownloadHandler(deps), ctx);
  registerRoute(router, recordConsentRoute, recordConsentHandler(deps), ctx);
  registerRoute(router, recordAgeSignalRoute, recordAgeSignalHandler(deps), ctx);
  registerRoute(router, setLocationRoute, setLocationHandler(deps), ctx);
  registerRoute(router, clearLocationRoute, clearLocationHandler(deps), ctx);
}
