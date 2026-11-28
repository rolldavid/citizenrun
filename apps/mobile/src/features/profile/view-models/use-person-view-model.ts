import { useEffect } from 'react';

import { replaceWith } from '@/lib/navigation';
import { querySource, useIsOnline, viewStateOf } from '@/lib/view-models/query';
import { links } from '@/platform/links';

import { usePerson } from '../data/use-person';
import { useSeatOffice } from '../data/use-seat-office';

import { buildPerson } from './person.build';
import type { PersonReadyData, PersonViewModel } from './person.types';

/** SCR-c-slug. */
export function usePersonViewModel(slug: string): PersonViewModel {
  const person = usePerson(slug);
  const detail = person.data;
  const currentSeat = detail?.seats.find((seat) => seat.current) ?? null;
  const seatSlug = currentSeat?.office.slug ?? null;
  // Read only for whether the office is partisan. It is no source of the page's state: while it
  // loads, and when it fails, the page is drawn without the party.
  const seatOffice = useSeatOffice(seatSlug);
  const online = useIsOnline();

  // A merged person answers with the surviving person, whose page this then is. The route is
  // replaced, so Back never returns to the old slug.
  const answeredSlug = detail?.slug ?? null;
  useEffect(() => {
    if (answeredSlug !== null && answeredSlug !== slug) {
      replaceWith(`/c/${answeredSlug}`);
    }
  }, [answeredSlug, slug]);

  const onRefresh = (): void => {
    void person.refetch();
    if (seatSlug !== null) {
      void seatOffice.refetch();
    }
  };

  const view = viewStateOf<PersonReadyData | null>(
    [querySource(person)],
    () =>
      detail === undefined
        ? null
        : buildPerson({
            person: detail,
            seatPartisan: seatOffice.data?.partisan ?? null,
            openExternal: (url) => {
              void links.openExternal(url);
            },
            onRefresh,
          }),
    online,
  );
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return { ...view, data: view.data };
}
