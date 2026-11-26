import { PartySchema } from '@citizenrun/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadParties } from './data-files.ts';
import type { PartiesFile } from './data-files.ts';
import { normaliseParty } from './party.ts';

let parties: PartiesFile;

beforeAll(async () => {
  parties = await loadParties();
});

describe('normaliseParty', () => {
  it.each([
    ['Democratic Party', 'democratic'],
    ['Prefers Republican Party', 'republican'],
    ['NPP', 'independent'],
    ['No Party Preference', 'independent'],
    ['Non-Partisan', null],
    ['', null],
    ['  GOP ', 'republican'],
    ['Working Families', 'working_families'],
    ['1st Choice', 'st_choice'],
    ['Green   Party', 'green'],
    ['   ', null],
    ['123', null],
  ])('%j gives %j', (label, expected) => {
    expect(normaliseParty(label, parties)).toBe(expected);
  });

  it('cuts a long label to a valid party key of at most 40 characters', () => {
    const label = 'The Very Long Name Of A Party That Nobody Has Heard Of Yet!';
    expect(label.length).toBeGreaterThanOrEqual(59);
    const key = normaliseParty(`${label} `, parties);
    expect(key).not.toBeNull();
    expect((key ?? '').length).toBeLessThanOrEqual(40);
    expect(key?.endsWith('_')).toBe(false);
    expect(PartySchema.safeParse(key).success).toBe(true);
  });

  it('never maps a label to a party it does not name', () => {
    expect(normaliseParty('Democratic Socialists', parties)).toBe('democratic_socialists');
    expect(normaliseParty('Independent American', parties)).toBe('independent_american');
  });
});
