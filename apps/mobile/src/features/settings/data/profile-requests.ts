import type { Me } from '@citizenrun/shared';
import { setHandle, updateMe } from '@citizenrun/shared/api';

import { attempt } from '@/lib/view-models/query';
import type { Outcome } from '@/lib/view-models/query';

// E-ME-02: an absent key is unchanged, null clears it
export function updateProfile(body: {
  name?: string | null;
  bio?: string | null;
  link?: string | null;
  avatarUploadKey?: string | null;
}): Promise<Outcome<Me>> {
  return attempt(() => updateMe(body));
}

// E-ME-08
export function changeHandle(handle: string): Promise<Outcome<Me>> {
  return attempt(() => setHandle({ handle }));
}
