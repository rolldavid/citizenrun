import type { PersonDetail } from '@citizenrun/shared';

import type { PersonReadyData } from './person.types';

export type BuildPersonInput = {
  person: PersonDetail;
  /** Whether the office of the current seat is partisan; null while that is not known. */
  seatPartisan: boolean | null;
  openExternal: (url: string) => void;
  onRefresh: () => void;
};

/** Opens a stored link, or null when the person has none. */
function opener(url: string | null, openExternal: (url: string) => void): (() => void) | null {
  return url === null
    ? null
    : () => {
        openExternal(url);
      };
}

/**
 * SCR-c-slug's ready data. The party shows only where the current office is known to be partisan
 * and the person's party is known: a tag is never guessed. Seats keep the order sent.
 */
export function buildPerson({
  person,
  seatPartisan,
  openExternal,
  onRefresh,
}: BuildPersonInput): PersonReadyData {
  return {
    person,
    showParty: person.party !== null && seatPartisan === true,
    onToggleFollow: null,
    links: {
      website: opener(person.website, openExternal),
      donate: opener(person.donateUrl, openExternal),
      volunteer: opener(person.volunteerUrl, openExternal),
    },
    seats: person.seats.map((seat) => ({ seat, officeHref: `/office/${seat.office.slug}` })),
    onRefresh,
  };
}
