import type { AccountDeletionView } from '@citizenrun/shared';
import { deleteMe } from '@citizenrun/shared/api';

import { attempt } from '@/lib/view-models/query';
import type { Outcome } from '@/lib/view-models/query';

// E-ME-03
export function deleteAccount(): Promise<Outcome<AccountDeletionView>> {
  return attempt(() => deleteMe());
}
