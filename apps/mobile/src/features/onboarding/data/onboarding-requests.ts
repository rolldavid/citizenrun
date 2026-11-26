import type { HandleCheck, Me, UploadTicket } from '@citizenrun/shared';
import {
  checkHandle as checkHandleRequest,
  createUpload,
  setHandle as setHandleRequest,
  setIssues as setIssuesRequest,
  skipOnboardingStep as skipOnboardingStepRequest,
  updateMe,
} from '@citizenrun/shared/api';

import { attempt } from '@/lib/view-models/query';
import type { Outcome } from '@/lib/view-models/query';
import type { PreparedFile } from '@/platform/upload/types';

// E-ME-10
export function skipOnboardingStep(step: 'photo' | 'location'): Promise<Outcome<Me>> {
  return attempt(() => skipOnboardingStepRequest({ step }));
}

// E-ME-08
export function setHandle(handle: string): Promise<Outcome<Me>> {
  return attempt(() => setHandleRequest({ handle }));
}

// E-ME-07: the handle travels in the query string, as the endpoint is defined
export function checkHandle(handle: string, signal: AbortSignal): Promise<Outcome<HandleCheck>> {
  return attempt(() => checkHandleRequest({ handle }, { signal }));
}

// E-ME-09
export function setIssues(
  issues: readonly { issueId: string; starred: boolean }[],
): Promise<Outcome<Me>> {
  return attempt(() =>
    setIssuesRequest({ issues: issues.map(({ issueId, starred }) => ({ issueId, starred })) }),
  );
}

// E-ME-02
export function attachAvatar(key: string): Promise<Outcome<Me>> {
  return attempt(() => updateMe({ avatarUploadKey: key }));
}

// E-UPL-01
export function createAvatarTicket(file: {
  contentType: PreparedFile['contentType'];
  size: number;
}): Promise<Outcome<UploadTicket>> {
  return attempt(() =>
    createUpload({
      kind: 'photo',
      purpose: 'avatar',
      contentType: file.contentType,
      size: file.size,
    }),
  );
}
