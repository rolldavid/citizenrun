import { describe, expect, it } from 'vitest';
import { englishT } from '../i18n/format/english-t.fixtures.ts';
import { partyLabel } from './party-label.ts';

const t = englishT();

describe('partyLabel', () => {
  it('democratic', () => {
    expect(partyLabel('democratic', t)).toBe('Democratic');
  });

  it('republican', () => {
    expect(partyLabel('republican', t)).toBe('Republican');
  });

  it('libertarian', () => {
    expect(partyLabel('libertarian', t)).toBe('Libertarian');
  });

  it('green', () => {
    expect(partyLabel('green', t)).toBe('Green');
  });

  it('independent', () => {
    expect(partyLabel('independent', t)).toBe('Independent');
  });

  it('any other key is shown with spaces', () => {
    expect(partyLabel('democratic_farmer_labor', t)).toBe('democratic farmer labor');
  });
});
