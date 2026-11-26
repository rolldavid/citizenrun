import { z } from 'zod';

/**
 * The `admin_actions.action` values public code writes (D-801), through `recordSystemAdminAction`
 * of `@citizenrun/db`. Each later milestone appends its own with the code that writes it. Every
 * admin route's action is the admin service's and is never listed here.
 */
export const SYSTEM_ADMIN_ACTIONS = ['admin.bootstrap'] as const;
export type SystemAdminAction = (typeof SYSTEM_ADMIN_ACTIONS)[number];
export const SystemAdminActionSchema = z.enum(SYSTEM_ADMIN_ACTIONS);
