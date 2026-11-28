import type { PersonDetail } from '@citizenrun/shared';

import type { Href } from '@/lib/view-models/common.types';
import type { ViewState } from '@/lib/view-state';

export type PersonReadyData = {
  person: PersonDetail;
  showParty: boolean; // the current office is partisan and the party is known
  onToggleFollow: (() => void) | null; // null until person follows exist
  links: {
    website: (() => void) | null;
    donate: (() => void) | null;
    volunteer: (() => void) | null;
  }; // links.openExternal; null when the URL is null
  seats: readonly { seat: PersonDetail['seats'][number]; officeHref: Href }[];
  onRefresh: () => void;
};

export type PersonViewModel = ViewState<PersonReadyData>;
