import { noop } from '@/lib/view-models/__fixtures__/common';

import type { StateUnavailableViewModel } from './state-unavailable.types';

export const stateUnavailableNamed = {
  stateCode: 'VT',
  signedIn: false,
  browseHref: '/',
  deleteHref: null,
  onBack: noop,
} satisfies StateUnavailableViewModel;

export const stateUnavailableGeneric = {
  stateCode: null,
  signedIn: true,
  browseHref: '/',
  deleteHref: '/settings/delete-account',
  onBack: noop,
} satisfies StateUnavailableViewModel;
