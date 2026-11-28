import type { OfficeRef, PersonDetail } from '@citizenrun/shared';

import { AVATAR_PHOTO_FIXTURE } from '@/ui/components/__fixtures__/avatar-photo';

import type { PersonReadyData, PersonViewModel } from './person.types';

// SCR-c-slug's states. Every person, office and place here is invented: Carol Wynn, the County
// Treasurer of Fixture Wren County in the state ZZ, who was its Deputy Treasurer before.

const noop = (): void => undefined;

type Seat = PersonDetail['seats'][number];

const TREASURER: OfficeRef = {
  id: '01890000-0000-7000-8000-000000000101',
  slug: 'county-treasurer-wren',
  title: 'County Treasurer',
  state: 'ZZ',
  jurisdictionName: 'Fixture Wren County',
  retiredAt: null,
};

const DEPUTY: OfficeRef = {
  id: '01890000-0000-7000-8000-000000000131',
  slug: 'deputy-treasurer-wren',
  title: 'Deputy Treasurer',
  state: 'ZZ',
  jurisdictionName: 'Fixture Wren County',
  retiredAt: null,
};

const TREASURER_SEAT: Seat = {
  office: TREASURER,
  seatLabel: null,
  since: '2019-01-01',
  until: null,
  current: true,
};

const DEPUTY_SEAT: Seat = {
  office: DEPUTY,
  seatLabel: null,
  since: '2015-01-01',
  until: '2018-12-31',
  current: false,
};

const CAROL_WYNN: PersonDetail = {
  id: '01890000-0000-7000-8000-000000000111',
  slug: 'carol-wynn',
  name: 'Carol Wynn',
  party: 'democratic',
  photo: null,
  photoCredit: null,
  claimed: false,
  rosterOnly: false,
  retiredAt: null,
  photoLicense: null,
  photoSourceUrl: null,
  photoSource: null,
  origin: 'bundle',
  website: 'https://carolwynn.example',
  // The campaign's own pages, the owner and the tools of a claimed profile are not sent yet.
  donateUrl: null,
  volunteerUrl: null,
  pendingLinks: null,
  seats: [TREASURER_SEAT, DEPUTY_SEAT],
  candidacies: [],
  claimedBy: null,
  followerCount: 0,
  tools: { claims: false, links: false, help: false },
  help: null,
  viewer: {
    following: false,
    isOwner: false,
    claimStatus: null,
    photoPending: false,
    pendingClaim: null,
  },
};

/** The ready data of a person, as the builder gives it for a detail and the party rule's answer. */
function dataOf(person: PersonDetail, showParty: boolean): PersonReadyData {
  return {
    person,
    showParty,
    onToggleFollow: null,
    links: {
      website: person.website === null ? null : noop,
      donate: null,
      volunteer: null,
    },
    seats: person.seats.map((seat) => ({ seat, officeHref: `/office/${seat.office.slug}` })),
    onRefresh: noop,
  };
}

const personReadyData: PersonReadyData = dataOf(CAROL_WYNN, true);

function ready(data: PersonReadyData): PersonViewModel {
  return { status: 'ready', data, refreshing: false, stale: false };
}

const LONG_NAME = 'Carolina Wynn-Abernathy Featherstonehaugh de las Montgomerie';
const LONG_TITLE =
  'Treasurer and Ex Officio Collector of Taxes, Fees and Assessments for the Consolidated Fixture County of Wren, Townships';
const LONG_PLACE = 'Fixture Consolidated County of Wren and the Lower Alder Vale';

const longNameData: PersonReadyData = dataOf(
  {
    ...CAROL_WYNN,
    slug: 'carolina-wynn-abernathy',
    name: LONG_NAME,
    seats: [
      {
        ...TREASURER_SEAT,
        office: { ...TREASURER, title: LONG_TITLE, jurisdictionName: LONG_PLACE },
      },
      { ...DEPUTY_SEAT, office: { ...DEPUTY, jurisdictionName: LONG_PLACE } },
    ],
  },
  true,
);

export const personLoading: PersonViewModel = { status: 'loading' };

export const personError: PersonViewModel = { status: 'error', code: 'internal', onRetry: noop };

export const personOffline: PersonViewModel = { status: 'offline', onRetry: noop };

export const personOfficeholder: PersonViewModel = ready(personReadyData);

export const personStale: PersonViewModel = {
  status: 'ready',
  data: personReadyData,
  refreshing: false,
  stale: true,
};

export const personNotFound: PersonViewModel = {
  status: 'error',
  code: 'not_found',
  onRetry: noop,
};

// A nonpartisan office: the person's party is known and is not shown.
export const personNoPhoto: PersonViewModel = ready(
  dataOf({ ...CAROL_WYNN, website: null }, false),
);

export const personPhotoCredit: PersonViewModel = ready(
  dataOf(
    {
      ...CAROL_WYNN,
      photo: {
        kind: 'image',
        key: AVATAR_PHOTO_FIXTURE.key,
        url: AVATAR_PHOTO_FIXTURE.url,
        width: 160,
        height: 160,
        blurhash: null,
        thumb: null,
        poster: null,
        durationMs: null,
      },
      photoCredit: 'Fixture Photographer',
      photoLicense: 'CC-BY-4.0',
      photoSourceUrl: 'https://commons.example/carol',
      photoSource: 'public_record',
    },
    true,
  ),
);

export const personFromFilings: PersonViewModel = ready(
  dataOf({ ...CAROL_WYNN, origin: 'filing' }, true),
);

// No longer listed: the seat ended the day before, so the person holds no office now.
export const personRetired: PersonViewModel = ready(
  dataOf(
    {
      ...CAROL_WYNN,
      retiredAt: '2026-10-01T00:00:00.000Z',
      seats: [{ ...TREASURER_SEAT, until: '2026-09-30', current: false }, DEPUTY_SEAT],
    },
    false,
  ),
);

export const personAllUnknown: PersonViewModel = ready(
  dataOf(
    {
      ...CAROL_WYNN,
      party: null,
      photo: null,
      photoCredit: null,
      photoLicense: null,
      website: null,
      origin: null,
      seats: [{ ...TREASURER_SEAT, since: null }],
    },
    false,
  ),
);

export const personLongName: PersonViewModel = ready(longNameData);

// The same page as personLongName; its capture draws the text 30% larger.
export const personTextScale: PersonViewModel = ready(longNameData);
