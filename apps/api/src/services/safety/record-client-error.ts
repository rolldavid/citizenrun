import { clientErrors } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { newId } from '@citizenrun/shared';
import type { CreateClientErrorBody } from '@citizenrun/shared';

/**
 * E-SAFE-02 step 2: stores one client error report with the fixed fields only. No user id is
 * stored, signed in or not (T-client_errors), and nothing is logged.
 */
export async function recordClientError(db: Db, body: CreateClientErrorBody): Promise<void> {
  await db.insert(clientErrors).values({
    id: newId(),
    name: body.name,
    code: body.code,
    route: body.route,
    component: body.component,
    appVersion: body.appVersion,
    platform: body.platform,
    frames: body.frames,
    requestId: body.requestId,
  });
}
