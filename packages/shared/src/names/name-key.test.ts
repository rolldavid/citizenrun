import { describe, expect, it } from 'vitest';
import { nameKey } from './name-key.ts';

/**
 * The thirty names of L-name-key-mirror, in order. The database's parity test holds the same
 * constant and compares each row with os_name_key.
 */
const NAME_KEY_FIXTURES: readonly (readonly [string | null, string | null, string | null])[] = [
  ['JOHN', 'SMITH', 'john smith'],
  ['Mary', 'Kopechne', 'mary kopechne'],
  ['Maria', 'Garcia Lopez', 'maria garcia lopez'],
  ['Robert', 'Smith', 'robert smith'],
  ['Katherine', "O'Brien", 'katherine obrien'],
  ['Juan', 'de la Cruz', 'juan de la cruz'],
  ['Jane', 'Doe', 'jane doe'],
  [null, 'Cher', 'cher'],
  ['Mary', 'V', 'mary v'],
  ['Ann', 'Lee', 'ann lee'],
  ['Anne', 'Lee', 'anne lee'],
  ['James', 'Miller', 'james miller'],
  ['James', 'Milner', 'james milner'],
  ['Jon', 'Smith', 'jon smith'],
  ['Joan', 'Smith', 'joan smith'],
  ['William', 'Johnson', 'william johnson'],
  ['Bill', 'Johnson', 'bill johnson'],
  ['Bob', 'Smith', 'bob smith'],
  ['José', "O'Brien-García", 'jose obriengarcia'],
  ['Zoë', 'Saldaña', 'zoe saldana'],
  ['François', 'Côté', 'francois cote'],
  ['Renée', 'Fleming-Núñez', 'renee flemingnunez'],
  ['Björn', 'Ångström', 'bjorn angstrom'],
  ['Łukasz', 'Wróbel', 'lukasz wrobel'],
  ['Søren', 'Kierkegaard', 'soren kierkegaard'],
  ['Hans', 'Groß', 'hans gross'],
  ['Mary-Kate', 'Olsen', 'marykate olsen'],
  ['  Ana  ', ' María ', 'ana maria'],
  [null, null, null],
  ['', '', null],
];

describe('nameKey', () => {
  it('has thirty fixture names', () => {
    expect(NAME_KEY_FIXTURES).toHaveLength(30);
  });

  for (const [index, [first, last, expected]] of NAME_KEY_FIXTURES.entries()) {
    it(`name ${String(index + 1)} gives its key`, () => {
      expect(nameKey(first, last)).toBe(expected);
    });
  }

  it('José O’Brien-García', () => {
    expect(nameKey('José', "O'Brien-García")).toBe('jose obriengarcia');
  });

  it('maps the letters that have no decomposition', () => {
    expect(nameKey('Æsa Œuvre', 'Đorđe Þór Ðan Kıvanç')).toBe('aesa oeuvre dorde thor dan kivanc');
  });

  it('keeps digits and drops other symbols', () => {
    expect(nameKey('Agent 47', 'Smith!')).toBe('agent 47 smith');
  });

  it('returns null when nothing but symbols remains', () => {
    expect(nameKey('---', '')).toBeNull();
  });
});
