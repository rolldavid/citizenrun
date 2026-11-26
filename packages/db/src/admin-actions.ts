import { SystemAdminActionSchema, newId } from '@citizenrun/shared';
import type { SystemAdminAction } from '@citizenrun/shared';
import { z } from 'zod';
import type { Tx } from './client.ts';
import { adminActions } from './schema/moderation.ts';

/** T-admin_actions: the nil admin id of a row with no admin request behind it. */
export const AUTOMATIC_ADMIN_ID = '00000000-0000-0000-0000-000000000000';

/**
 * An `admin_actions.target`: `{ type, id, ... }` with string ids. It never holds an email address,
 * message text or a user's own text (T-admin_actions).
 */
export type AdminActionTarget = { type: string; id: string; [key: string]: unknown };

const TargetJsonSchema = z.record(z.string(), z.json());
const TargetKeysSchema = z.object({ type: z.string().min(1), id: z.string().min(1) });

/**
 * The bare insert: one `admin_actions` row in `tx`, its target parsed as JSON with `type` and `id`
 * required as strings first; returns the row's id. Checks nothing about `action`. Never logs; a
 * refusal throws a fixed message that carries no value.
 */
export async function insertAdminAction(
  tx: Tx,
  row: { adminId: string; action: string; target: AdminActionTarget },
): Promise<string> {
  const target = TargetJsonSchema.safeParse(row.target);
  if (!target.success || !TargetKeysSchema.safeParse(target.data).success) {
    throw new Error('The admin action target is not valid.');
  }
  const id = newId();
  await tx.insert(adminActions).values({
    id,
    adminId: row.adminId,
    action: row.action,
    target: target.data,
  });
  return id;
}

/** The one writer of public code: accepts only `SYSTEM_ADMIN_ACTIONS`, then inserts the row. */
export async function recordSystemAdminAction(
  tx: Tx,
  input: { adminId: string; action: SystemAdminAction; target: AdminActionTarget },
): Promise<string> {
  const action = SystemAdminActionSchema.safeParse(input.action);
  if (!action.success) {
    throw new Error('The admin action is not a system action.');
  }
  return insertAdminAction(tx, {
    adminId: input.adminId,
    action: action.data,
    target: input.target,
  });
}
