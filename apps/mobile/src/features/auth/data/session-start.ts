import type { SessionInfo } from '@citizenrun/shared';
import type { QueryClient } from '@tanstack/react-query';

import { writeMeToCache } from '@/features/system';
import { setSessionPresence } from '@/lib/session-state';
import { session } from '@/platform/session';

/** What every successful sign-in does (SCR-sign-in rule 7; PM-session-tokens). Nothing navigates. */
export async function startSession(
  info: SessionInfo,
  client: QueryClient,
): Promise<'started' | 'store_failed'> {
  try {
    await session.adopt({ token: info.token, expiresAt: info.expiresAt });
  } catch {
    return 'store_failed';
  }
  writeMeToCache(client, info.me);
  setSessionPresence('present');
  return 'started';
}
