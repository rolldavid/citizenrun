import { describe, expect, it } from 'vitest';
import { SlugSchema } from './common.ts';
import { kebab, officeSlugBase, personSlug } from './slug.ts';

describe('kebab', () => {
  it('turns & into and and joins words with hyphens', () => {
    expect(kebab('Saint-Jean & Fils')).toBe('saint-jean-and-fils');
  });

  it('removes accents and trims hyphens', () => {
    expect(kebab('  Ñandú  ')).toBe('nandu');
  });

  it('collapses every run outside a-z0-9 into one hyphen', () => {
    expect(kebab("O'Brien -- Smith, Jr.")).toBe('o-brien-smith-jr');
  });
});

describe('officeSlugBase', () => {
  it('uses the title alone when it names the jurisdiction', () => {
    expect(officeSlugBase('NC', 'Wake County', 'Wake County Board of Commissioners')).toBe(
      'nc-wake-county-board-of-commissioners',
    );
  });

  it('adds the jurisdiction name when the title does not hold it', () => {
    expect(officeSlugBase('NC', 'Wake County', 'Sheriff')).toBe('nc-wake-county-sheriff');
  });

  it('cuts a long base at a hyphen boundary within 113 characters', () => {
    const title = Array.from({ length: 40 }, (_, i) => `word${String(i)}`).join(' ');
    expect(title.length).toBeGreaterThanOrEqual(200);
    const base = officeSlugBase('NC', 'Fixture County', title);
    expect(base.length).toBeLessThanOrEqual(113);
    const full = kebab(`NC Fixture County ${title}`);
    expect(full.startsWith(base)).toBe(true);
    expect(full.charAt(base.length)).toBe('-');
    expect(SlugSchema.safeParse(base).success).toBe(true);
  });
});

describe('personSlug', () => {
  it('is the kebab name and 8 hex characters of the source key hash', () => {
    // printf 'bioguide:X000001' | shasum -a 256 begins 0a57756b.
    expect(personSlug("José O'Brien", 'bioguide:X000001')).toBe('jose-o-brien-0a57756b');
  });

  it('cuts the name at 100 characters and stays a valid slug', () => {
    const slug = personSlug(`${'a'.repeat(99)} ${'b'.repeat(50)}`, 'openstates:fixture');
    expect(slug.startsWith(`${'a'.repeat(99)}-`)).toBe(true);
    expect(slug).toMatch(/^a{99}-[0-9a-f]{8}$/);
    expect(SlugSchema.safeParse(slug).success).toBe(true);
  });
});
