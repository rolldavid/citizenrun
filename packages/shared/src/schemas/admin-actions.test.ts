import { describe, expect, it } from 'vitest';
import { SYSTEM_ADMIN_ACTIONS, SystemAdminActionSchema } from './admin-actions.ts';

describe('SYSTEM_ADMIN_ACTIONS', () => {
  it('holds the actions public code writes in milestone 2', () => {
    expect(SYSTEM_ADMIN_ACTIONS).toEqual(['admin.bootstrap']);
    expect(SystemAdminActionSchema.safeParse('admin.bootstrap').success).toBe(true);
  });

  it("refuses an admin route's action", () => {
    expect(SystemAdminActionSchema.safeParse('bundle.reload').success).toBe(false);
    expect(SystemAdminActionSchema.safeParse('').success).toBe(false);
  });
});
