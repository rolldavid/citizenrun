import { partyLabel } from '@citizenrun/shared';
import type { ErrorCode, PersonDetail, TFunction } from '@citizenrun/shared';
import { createElement } from 'react';

import type { PersonReadyData } from '@/features/profile/view-models/person.types';
import type { ListRowProps } from '@/ui/components/list-row';
import { OfficeTile } from '@/ui/components/office-tile';
import type { ProfileHeaderProps } from '@/ui/components/profile-header';
import { Tag } from '@/ui/components/tag';
import { sourceDomain } from '@/ui/present';

/** The ids of SCR-c-slug's parts. A seat's row adds its office's slug to `seat`. */
export const PERSON_TEST_IDS = {
  screen: 'person.screen',
  loading: 'person.loading',
  header: 'person.header',
  retiredNotice: 'person.notice-retired',
  notFoundAction: 'person.not-found-action',
  retry: 'person.screen-retry',
  seat: 'person.seat',
} as const;

/** The year of a calendar date, as its first four characters; no date is built. */
function yearOf(date: string): string {
  return date.slice(0, 4);
}

/** The credit under a photo: its author and licence, as far as each is known (D-333). */
function photoCreditText(person: PersonDetail, t: TFunction): string {
  if (person.photoCredit === null) {
    return t('profile:photo.creditUnknown');
  }
  if (person.photoLicense === null) {
    return t('profile:photo.creditNoLicense', { credit: person.photoCredit });
  }
  return t('profile:photo.credit', { credit: person.photoCredit, license: person.photoLicense });
}

/**
 * C-ProfileHeader's props for a person from public records. Every person gets the same header:
 * the photo or the initials, the name, the office held now and its place, and the party as a
 * word, only where the page knows that office is partisan. No counts and no actions are drawn.
 */
export function presentPersonHeader(data: PersonReadyData, t: TFunction): ProfileHeaderProps {
  const { person } = data;
  const current = data.seats.find((each) => each.seat.current) ?? null;
  const lines: string[] = [];
  if (current !== null) {
    lines.push(
      t('profile:person.holds', {
        office: current.seat.office.title,
        place: current.seat.office.jurisdictionName,
      }),
    );
  }
  if (person.origin === 'filing' && !person.claimed) {
    lines.push(t('profile:person.fromFilings'));
  }
  // A website that is no https link with a host is not offered as a link.
  const domain = sourceDomain(person.website);
  return {
    image: person.photo === null ? null : { key: person.photo.key, url: person.photo.url },
    name: person.name,
    handle: null,
    tag:
      data.showParty && person.party !== null
        ? createElement(Tag, { label: partyLabel(person.party, t), variant: 'outline' })
        : null,
    lines,
    bio: null,
    link: person.website === null || domain === null ? null : { href: person.website, domain },
    photoCredit: person.photo === null ? null : photoCreditText(person, t),
    stats: [],
    actions: [],
    notice: null,
    testID: PERSON_TEST_IDS.header,
  };
}

/**
 * C-ListRow's props for one office the person holds or held: the plain office tile, the office's
 * title, and the year the seat began or ended as far as it is known. The row opens the office.
 */
export function presentSeatRow(item: PersonReadyData['seats'][number], t: TFunction): ListRowProps {
  const { seat } = item;
  let subtitle: string;
  if (seat.current && seat.since !== null) {
    subtitle = t('profile:person.since', { year: yearOf(seat.since) });
  } else if (!seat.current && seat.until !== null) {
    subtitle = t('profile:person.until', { year: yearOf(seat.until) });
  } else {
    subtitle = t('profile:person.sinceUnknown');
  }
  return {
    // A seat names its office without the office's type, so the tile carries no glyph.
    leading: createElement(OfficeTile, { illustration: null, size: 'md' }),
    title: seat.office.title,
    subtitle,
    trailing: { kind: 'chevron' },
    href: item.officeHref,
    testID: `${PERSON_TEST_IDS.seat}-${seat.office.slug}`,
  };
}

/**
 * The sentence of an error code. The one code whose sentence holds a date this page does not have
 * reads the generic sentence.
 */
export function errorSentence(code: ErrorCode, t: TFunction): string {
  return code === 'handle_change_too_soon' ? t('errors:generic') : t(`errors:${code}`);
}
