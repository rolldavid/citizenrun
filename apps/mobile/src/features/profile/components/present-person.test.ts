import { createI18n } from '@citizenrun/shared';
import type { PersonDetail, TFunction } from '@citizenrun/shared';
import { isValidElement } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/profile/view-models/person.fixtures';
import type { PersonReadyData, PersonViewModel } from '@/features/profile/view-models/person.types';
import { OfficeTile } from '@/ui/components/office-tile';
import { Tag } from '@/ui/components/tag';

import { errorSentence, presentPersonHeader, presentSeatRow } from './present-person';

// The presenters name the tag and the office tile they hand to the header and the row, and never
// draw them. The parts that draw load modules only a page or a phone can, and this project has
// neither, so each is stood in for by a component that draws nothing; its props are read here.
vi.mock('@/ui/components/flag', () => ({ Flag: (): null => null }));
vi.mock('@/ui/components/text', () => ({ Text: (): null => null }));
vi.mock('@/ui/components/tag', () => ({ Tag: (): null => null }));
vi.mock('@/ui/components/office-tile', () => ({ OfficeTile: (): null => null }));

// The typed t accepts catalog keys only; the presenters pass each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;

function dataOf(vm: PersonViewModel): PersonReadyData {
  if (vm.status !== 'ready') {
    throw new Error('the fixture is not a ready state');
  }
  return vm.data;
}

const OFFICEHOLDER = dataOf(fixtures.personOfficeholder);

function withPerson(data: PersonReadyData, over: Partial<PersonDetail>): PersonReadyData {
  return { ...data, person: { ...data.person, ...over } };
}

/** The props of an element a presenter made. */
function propsOf(node: unknown): unknown {
  if (!isValidElement(node)) {
    throw new Error('the presenter made no element');
  }
  const element: ReactElement = node;
  return element.props;
}

function seat(over: Partial<PersonDetail['seats'][number]>): PersonReadyData['seats'][number] {
  const [first] = OFFICEHOLDER.seats;
  if (first === undefined) {
    throw new Error('the fixture has a seat');
  }
  return { ...first, seat: { ...first.seat, ...over } };
}

describe('presentPersonHeader', () => {
  it('header lines', () => {
    expect(presentPersonHeader(OFFICEHOLDER, t).lines).toEqual([
      'County Treasurer, Fixture Wren County',
    ]);
    expect(presentPersonHeader(dataOf(fixtures.personFromFilings), t).lines).toEqual([
      'County Treasurer, Fixture Wren County',
      'Created from public filings',
    ]);
    // A claimed profile is its owner's, whatever it was made from.
    const claimed = withPerson(dataOf(fixtures.personFromFilings), { claimed: true });
    expect(presentPersonHeader(claimed, t).lines).toEqual([
      'County Treasurer, Fixture Wren County',
    ]);
    // With no office held now there is no office line.
    expect(presentPersonHeader(dataOf(fixtures.personRetired), t).lines).toEqual([]);
  });

  it('party tag', () => {
    const { tag } = presentPersonHeader(OFFICEHOLDER, t);
    expect(tag?.type).toBe(Tag);
    expect(propsOf(tag)).toEqual({ label: 'Democratic', variant: 'outline' });
    // The party is known and the office is nonpartisan.
    expect(dataOf(fixtures.personNoPhoto).person.party).toBe('democratic');
    expect(presentPersonHeader(dataOf(fixtures.personNoPhoto), t).tag).toBeNull();
    // A party the catalog has no word for is shown as it is stored.
    const other = withPerson(OFFICEHOLDER, { party: 'working_families' });
    expect(propsOf(presentPersonHeader(other, t).tag)).toEqual({
      label: 'working families',
      variant: 'outline',
    });
    expect(presentPersonHeader(withPerson(OFFICEHOLDER, { party: null }), t).tag).toBeNull();
  });

  it('photo credit', () => {
    const credited = dataOf(fixtures.personPhotoCredit);
    const header = presentPersonHeader(credited, t);
    expect(header.photoCredit).toBe('Photo: Fixture Photographer, CC-BY-4.0.');
    expect(header.image).toEqual({
      key: credited.person.photo?.key,
      url: credited.person.photo?.url,
    });
    expect(presentPersonHeader(withPerson(credited, { photoLicense: null }), t).photoCredit).toBe(
      'Photo: Fixture Photographer.',
    );
    expect(
      presentPersonHeader(withPerson(credited, { photoCredit: null, photoLicense: null }), t)
        .photoCredit,
    ).toBe('Photo credit not known yet.');
    // No photo: the initials, and nothing to credit even when a credit is stored.
    const noPhoto = presentPersonHeader(withPerson(credited, { photo: null }), t);
    expect(noPhoto.photoCredit).toBeNull();
    expect(noPhoto.image).toBeNull();
  });

  it('the website is a link only when it is an https address', () => {
    expect(presentPersonHeader(OFFICEHOLDER, t).link).toEqual({
      href: 'https://carolwynn.example',
      domain: 'carolwynn.example',
    });
    const www = withPerson(OFFICEHOLDER, { website: 'https://www.carolwynn.example/about' });
    expect(presentPersonHeader(www, t).link).toEqual({
      href: 'https://www.carolwynn.example/about',
      domain: 'carolwynn.example',
    });
    for (const website of ['http://carolwynn.example', 'carolwynn.example', null]) {
      expect(
        presentPersonHeader(withPerson(OFFICEHOLDER, { website }), t).link,
        website ?? '',
      ).toBe(null);
    }
  });

  it('no stats and no actions', () => {
    for (const [name, vm] of Object.entries(fixtures)) {
      if (vm.status !== 'ready') {
        continue;
      }
      const header = presentPersonHeader(vm.data, t);
      expect(header.stats, name).toEqual([]);
      expect(header.actions, name).toEqual([]);
      expect(header.handle, name).toBeNull();
      expect(header.bio, name).toBeNull();
      expect(header.notice, name).toBeNull();
      expect(header.name, name).toBe(vm.data.person.name);
      expect(header.testID, name).toBe('person.header');
    }
  });
});

describe('presentSeatRow', () => {
  it('seat lines', () => {
    expect(
      presentSeatRow(seat({ current: true, since: '2019-01-01', until: null }), t).subtitle,
    ).toBe('Since 2019');
    expect(
      presentSeatRow(seat({ current: false, since: '2015-01-01', until: '2018-12-31' }), t)
        .subtitle,
    ).toBe('Until 2018');
    expect(presentSeatRow(seat({ current: true, since: null, until: null }), t).subtitle).toBe(
      'Start year not known yet',
    );
    // A past seat whose end is not known says no year it cannot stand behind.
    expect(
      presentSeatRow(seat({ current: false, since: '2015-01-01', until: null }), t).subtitle,
    ).toBe('Start year not known yet');
  });

  it('the row is the plain office tile, the title and a way to the office', () => {
    const [first] = OFFICEHOLDER.seats;
    if (first === undefined) {
      throw new Error('the fixture has a seat');
    }
    const row = presentSeatRow(first, t);
    expect(isValidElement(row.leading) ? row.leading.type : null).toBe(OfficeTile);
    expect(propsOf(row.leading)).toEqual({ illustration: null, size: 'md' });
    expect(row.title).toBe('County Treasurer');
    expect(row.trailing).toEqual({ kind: 'chevron' });
    expect(row.href).toBe('/office/county-treasurer-wren');
    expect(row.testID).toBe('person.seat-county-treasurer-wren');
    // The place is in the header; a row never repeats it.
    expect(JSON.stringify([row.title, row.subtitle])).not.toContain('Wren County');
  });
});

describe('errorSentence', () => {
  it('reads the sentence of the code', () => {
    expect(errorSentence('internal', t)).toBe(t('errors:internal'));
    expect(errorSentence('internal', t)).not.toBe('');
    expect(errorSentence('handle_change_too_soon', t)).toBe(t('errors:generic'));
  });
});
