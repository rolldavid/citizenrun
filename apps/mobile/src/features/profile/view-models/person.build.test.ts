import type { PersonDetail } from '@citizenrun/shared';
import { describe, expect, it, vi } from 'vitest';

import { buildPerson } from './person.build';
import { personOfficeholder } from './person.fixtures';

function fixturePerson(): PersonDetail {
  if (personOfficeholder.status !== 'ready') {
    throw new Error('the fixture is not a ready state');
  }
  return personOfficeholder.data.person;
}

const CAROL = fixturePerson();
const noop = (): void => undefined;

function build(over: Partial<PersonDetail>, seatPartisan: boolean | null) {
  return buildPerson({
    person: { ...CAROL, ...over },
    seatPartisan,
    openExternal: noop,
    onRefresh: noop,
  });
}

describe('buildPerson', () => {
  it('party only in a partisan office', () => {
    expect(build({ party: 'democratic' }, true).showParty).toBe(true);
    expect(build({ party: 'democratic' }, false).showParty).toBe(false);
    // The office's answer has not arrived, or never will.
    expect(build({ party: 'democratic' }, null).showParty).toBe(false);
    expect(build({ party: null }, true).showParty).toBe(false);
  });

  it('links', () => {
    const openExternal = vi.fn();
    const built = buildPerson({
      person: { ...CAROL, website: 'https://carolwynn.example', donateUrl: null },
      seatPartisan: true,
      openExternal,
      onRefresh: noop,
    });
    expect(built.links.donate).toBeNull();
    expect(built.links.volunteer).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
    built.links.website?.();
    expect(openExternal.mock.calls).toEqual([['https://carolwynn.example']]);

    expect(build({ website: null }, true).links.website).toBeNull();
  });

  it('the campaign links open their own pages when they are sent', () => {
    const openExternal = vi.fn();
    const built = buildPerson({
      person: {
        ...CAROL,
        donateUrl: 'https://carolwynn.example/give',
        volunteerUrl: 'https://carolwynn.example/help',
      },
      seatPartisan: true,
      openExternal,
      onRefresh: noop,
    });
    built.links.donate?.();
    built.links.volunteer?.();
    expect(openExternal.mock.calls).toEqual([
      ['https://carolwynn.example/give'],
      ['https://carolwynn.example/help'],
    ]);
  });

  it('seats link to their office pages in the order sent', () => {
    const built = build({}, true);
    expect(built.seats.map((each) => each.seat)).toEqual(CAROL.seats);
    expect(built.seats.map((each) => each.officeHref)).toEqual([
      '/office/county-treasurer-wren',
      '/office/deputy-treasurer-wren',
    ]);
    // A past seat sent first stays first: the order is the response's, never this page's.
    const [current, past] = CAROL.seats;
    if (current === undefined || past === undefined) {
      throw new Error('the fixture has two seats');
    }
    expect(build({ seats: [past, current] }, true).seats.map((each) => each.officeHref)).toEqual([
      '/office/deputy-treasurer-wren',
      '/office/county-treasurer-wren',
    ]);
  });

  it('no follow yet', () => {
    expect(build({}, true).onToggleFollow).toBeNull();
    expect(
      build({ viewer: { ...CAROL.viewer, following: true } }, false).onToggleFollow,
    ).toBeNull();
  });

  it('refresh is the one given', () => {
    const onRefresh = vi.fn();
    const built = buildPerson({
      person: CAROL,
      seatPartisan: null,
      openExternal: noop,
      onRefresh,
    });
    built.onRefresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
