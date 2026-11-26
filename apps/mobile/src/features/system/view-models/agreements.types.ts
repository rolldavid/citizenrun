import type { ErrorCode } from '@citizenrun/shared';

import type { Href } from '@/lib/view-models/common.types';

/** SCR-system-agreements (D-351, D-464, CTL-77). */
export type AgreementsViewModel = {
  needed: readonly ('terms' | 'content_policy' | 'privacy_policy')[];
  links: { terms: string; contentPolicy: string; privacyPolicy: string }; // absolute https URLs of the public pages
  status: 'idle' | 'saving' | 'error';
  errorCode: ErrorCode | null; // the refusal's code while status is 'error'; null otherwise
  onAgree: () => void; // iOS: awaits ageAssurance.acknowledgeSignificantUpdate() first when it is required (PM-age-assurance)
  deleteHref: Href; // '/settings/delete-account'
};
