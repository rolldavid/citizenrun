import { describe, expect, it } from 'vitest';
import { parseName } from './parse.ts';
import type { NameParts } from './parse.ts';

function parts(
  first: string | null,
  middle: string | null,
  last: string | null,
  suffix: NameParts['suffix'] = null,
  nickname: string | null = null,
): NameParts {
  return { first, middle, last, suffix, nickname };
}

describe('parseName', () => {
  // The thirteen rows of L-name-parse.
  it('SMITH, JOHN A', () => {
    expect(parseName('SMITH, JOHN A')).toEqual(parts('JOHN', 'A', 'SMITH'));
  });

  it('Smith, John A., Jr.', () => {
    expect(parseName('Smith, John A., Jr.')).toEqual(parts('John', 'A.', 'Smith', 'jr'));
  });

  it('John Allen Smith', () => {
    expect(parseName('John Allen Smith')).toEqual(parts('John', 'Allen', 'Smith'));
  });

  it('Mary Jo Kopechne', () => {
    expect(parseName('Mary Jo Kopechne')).toEqual(parts('Mary', 'Jo', 'Kopechne'));
  });

  it('Garcia Lopez, Maria', () => {
    expect(parseName('Garcia Lopez, Maria')).toEqual(parts('Maria', null, 'Garcia Lopez'));
  });

  it('Maria Garcia Lopez', () => {
    expect(parseName('Maria Garcia Lopez')).toEqual(parts('Maria', 'Garcia', 'Lopez'));
  });

  it('Robert "Bob" Smith', () => {
    expect(parseName('Robert "Bob" Smith')).toEqual(parts('Robert', null, 'Smith', null, 'Bob'));
  });

  it("Dr. Katherine O'Brien", () => {
    expect(parseName("Dr. Katherine O'Brien")).toEqual(parts('Katherine', null, "O'Brien"));
  });

  it('Juan de la Cruz', () => {
    expect(parseName('Juan de la Cruz')).toEqual(parts('Juan', null, 'de la Cruz'));
  });

  it('John Smith III', () => {
    expect(parseName('John Smith III')).toEqual(parts('John', null, 'Smith', 'iii'));
  });

  it('Jane Doe, Esq.', () => {
    expect(parseName('Jane Doe, Esq.')).toEqual(parts('Jane', null, 'Doe'));
  });

  it('Cher', () => {
    expect(parseName('Cher')).toEqual(parts(null, null, 'Cher'));
  });

  it('Mary V', () => {
    expect(parseName('Mary V')).toEqual(parts('Mary', null, 'V'));
  });

  // Further cases.
  it('The Honorable Jane Doe', () => {
    expect(parseName('The Honorable Jane Doe')).toEqual(parts('Jane', null, 'Doe'));
    expect(parseName('the HONORABLE Jane Doe')).toEqual(parts('Jane', null, 'Doe'));
  });

  it('Mr. John Smith', () => {
    expect(parseName('Mr. John Smith')).toEqual(parts('John', null, 'Smith'));
  });

  it('several prefixes are all removed', () => {
    expect(parseName('Hon. Judge Ann Lee')).toEqual(parts('Ann', null, 'Lee'));
  });

  it('SMITH, JR.', () => {
    expect(parseName('SMITH, JR.')).toEqual(parts(null, null, 'SMITH', 'jr'));
  });

  it('Robert “Bob” Smith', () => {
    expect(parseName('Robert “Bob” Smith')).toEqual(parts('Robert', null, 'Smith', null, 'Bob'));
  });

  it('Robert (Bob) Smith', () => {
    expect(parseName('Robert (Bob) Smith')).toEqual(parts('Robert', null, 'Smith', null, 'Bob'));
  });

  it("John 'Jack' Kennedy", () => {
    expect(parseName("John 'Jack' Kennedy")).toEqual(parts('John', null, 'Kennedy', null, 'Jack'));
  });

  it('only the earliest quoted text is the nickname', () => {
    expect(parseName('Robert (Bob) "Bobby" Smith')).toEqual(
      parts('Robert', '"Bobby"', 'Smith', null, 'Bob'),
    );
    expect(parseName('Robert "Bobby" (Bob) Smith')).toEqual(
      parts('Robert', '(Bob)', 'Smith', null, 'Bobby'),
    );
  });

  it('an apostrophe inside a word is never a quote', () => {
    expect(parseName("Katherine O'Brien 'Kat'")).toEqual(
      parts('Katherine', null, "O'Brien", null, 'Kat'),
    );
    expect(parseName("O'Brien, D'Arcy")).toEqual(parts("D'Arcy", null, "O'Brien"));
  });

  it('a quote at the end of the name is a nickname', () => {
    expect(parseName('Robert Smith "Bob"')).toEqual(parts('Robert', null, 'Smith', null, 'Bob'));
  });

  it('Jane Q. Public PhD', () => {
    expect(parseName('Jane Q. Public PhD')).toEqual(parts('Jane', 'Q.', 'Public'));
  });

  it('a credential before the comma keeps the comma form', () => {
    expect(parseName('Doe Esq., Jane')).toEqual(parts('Jane', null, 'Doe'));
    expect(parseName('Smith, MD, John')).toEqual(parts('John', null, 'Smith'));
  });

  it('Smith, Dr. John', () => {
    expect(parseName('Smith, Dr. John')).toEqual(parts('John', null, 'Smith'));
  });

  it('Smith, John Jr', () => {
    expect(parseName('Smith, John Jr')).toEqual(parts('John', null, 'Smith', 'jr'));
  });

  it('a suffix written after the surname in the comma form', () => {
    expect(parseName('Smith Jr., John')).toEqual(parts('John', null, 'Smith', 'jr'));
  });

  it('every written form of a suffix', () => {
    expect(parseName('John Smith Junior').suffix).toBe('jr');
    expect(parseName('John Smith Sr.').suffix).toBe('sr');
    expect(parseName('John Smith senior').suffix).toBe('sr');
    expect(parseName('John Smith II').suffix).toBe('ii');
    expect(parseName('John Smith 2nd').suffix).toBe('ii');
    expect(parseName('John Smith 3rd').suffix).toBe('iii');
    expect(parseName('John Smith IV').suffix).toBe('iv');
    expect(parseName('John Smith 4th').suffix).toBe('iv');
    expect(parseName('John Smith V').suffix).toBe('v');
    expect(parseName('John Smith 5th').suffix).toBe('v');
    expect(parseName('John Smith VI').suffix).toBe('vi');
  });

  it('John, Smith with format first_last', () => {
    expect(parseName('John, Smith', 'first_last')).toEqual(parts('John', null, 'Smith'));
  });

  it('John, Smith with format auto reads the comma form', () => {
    expect(parseName('John, Smith')).toEqual(parts('Smith', null, 'John'));
  });

  it('last_first without a comma falls back to the space form', () => {
    expect(parseName('John Smith', 'last_first')).toEqual(parts('John', null, 'Smith'));
  });

  it('a particle never takes the first name', () => {
    expect(parseName('De Smith')).toEqual(parts('De', null, 'Smith'));
    expect(parseName('Ludwig van Beethoven')).toEqual(parts('Ludwig', null, 'van Beethoven'));
  });

  it('whitespace is collapsed and compatibility forms are unified', () => {
    expect(parseName('  John\t Allen   Smith ')).toEqual(parts('John', 'Allen', 'Smith'));
    // NFKC turns a fullwidth letter into its plain form.
    expect(parseName('Ｊohn Smith')).toEqual(parts('John', null, 'Smith'));
  });

  it('the empty string', () => {
    expect(parseName('')).toEqual(parts(null, null, null));
    expect(parseName('   ')).toEqual(parts(null, null, null));
  });
});
