import { noop } from '@/lib/view-models/__fixtures__/common';

import type { AgreementsViewModel } from './agreements.types';

export const agreementsTerms = {
  needed: ['terms', 'content_policy'],
  links: {
    terms: 'https://example.test/terms',
    contentPolicy: 'https://example.test/content-policy',
    privacyPolicy: 'https://example.test/privacy',
  },
  status: 'idle',
  errorCode: null,
  onAgree: noop,
  deleteHref: '/settings/delete-account',
} satisfies AgreementsViewModel;

export const agreementsPrivacyOnly = {
  ...agreementsTerms,
  needed: ['privacy_policy'],
} satisfies AgreementsViewModel;

export const agreementsSaving = {
  ...agreementsTerms,
  status: 'saving',
} satisfies AgreementsViewModel;

export const agreementsError = {
  ...agreementsTerms,
  status: 'error',
  errorCode: 'unavailable',
} satisfies AgreementsViewModel;
