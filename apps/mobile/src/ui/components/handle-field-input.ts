import { HANDLE_MAX } from '@citizenrun/shared';

/**
 * What typing leaves in a handle field (L-handle-rules): lower case, without one leading `@`, only
 * the characters a handle may hold, and no longer than a handle may be.
 */
export function sanitizeHandleInput(text: string): string {
  const lower = text.toLowerCase();
  const bare = lower.startsWith('@') ? lower.slice(1) : lower;
  return bare.replace(/[^a-z0-9_.]/g, '').slice(0, HANDLE_MAX);
}
