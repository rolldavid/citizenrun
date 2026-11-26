import { noop } from '@/lib/view-models/__fixtures__/common';

import type { AdultsOnlyViewModel } from './adults-only.types';

export const adultsOnly = { onClose: noop } satisfies AdultsOnlyViewModel;
