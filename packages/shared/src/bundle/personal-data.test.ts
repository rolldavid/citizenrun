import { describe, expect, it } from 'vitest';
import { EMAIL, PHONE, PO_BOX, STREET_ADDRESS, looksPersonal } from './personal-data.ts';

describe('personal-data patterns', () => {
  it('finds street addresses', () => {
    for (const s of ['123 Main St', '4500 N. Oak Avenue', '12 West Elm Street Apt 4']) {
      expect(STREET_ADDRESS.test(s), s).toBe(true);
      expect(looksPersonal(s), s).toBe(true);
    }
  });

  it('finds post office boxes', () => {
    for (const s of ['PO Box 45', 'P.O. Box 9']) {
      expect(PO_BOX.test(s), s).toBe(true);
      expect(looksPersonal(s), s).toBe(true);
    }
  });

  it('finds phone numbers', () => {
    for (const s of ['(919) 555-0134', '919.555.0134', '+1 919 555 0134', '919-555-0100']) {
      expect(PHONE.test(s), s).toBe(true);
      expect(looksPersonal(s), s).toBe(true);
    }
  });

  it('finds email addresses', () => {
    expect(EMAIL.test('jane@example.test')).toBe(true);
    expect(looksPersonal('jane@example.test')).toBe(true);
  });

  it('leaves civic text alone', () => {
    for (const s of [
      'Wake County Board of Commissioners',
      'City Council Place 2',
      'RCW 29A.24.050',
      '2027-11-02',
      'Robert "Bob" Smith',
      'District 12',
      '555-0100',
    ]) {
      expect(looksPersonal(s), s).toBe(false);
    }
  });

  it('is not stateful', () => {
    for (const s of [
      '123 Main St',
      'PO Box 45',
      '919-555-0100',
      'jane@example.test',
      'District 12',
    ]) {
      expect(looksPersonal(s)).toBe(looksPersonal(s));
    }
    for (const pattern of [STREET_ADDRESS, PO_BOX, PHONE, EMAIL]) {
      expect(pattern.global, pattern.source).toBe(false);
    }
  });
});
