import { describe, expect, it } from 'vitest';
import { TitleError, fillLabel, fillTitle } from './title.ts';

describe('fillTitle', () => {
  it('fills the jurisdiction and the label', () => {
    expect(
      fillTitle('{jurisdiction} City Council, {label}', {
        jurisdiction: 'Fixture City',
        label: 'District 2',
      }),
    ).toBe('Fixture City City Council, District 2');
  });

  it('fills the position and collapses whitespace', () => {
    expect(
      fillTitle('  State Representative,   District {label}, {position} ', {
        label: '7',
        position: 'Position 1',
      }),
    ).toBe('State Representative, District 7, Position 1');
  });

  it('throws on an unknown token', () => {
    expect(() => fillTitle('{jurisdiction} {seat}', { jurisdiction: 'Fixture City' })).toThrow(
      TitleError,
    );
  });

  it('throws when a token has no value', () => {
    expect(() =>
      fillTitle('{jurisdiction} City Council, {label}', { jurisdiction: 'Fixture City' }),
    ).toThrow(TitleError);
  });

  it('throws on a result longer than 200 characters', () => {
    expect(() => fillTitle('{jurisdiction} Council', { jurisdiction: 'F'.repeat(193) })).toThrow(
      TitleError,
    );
    expect(fillTitle('{jurisdiction} Council', { jurisdiction: 'F'.repeat(192) })).toHaveLength(
      200,
    );
  });

  it('throws on an empty result', () => {
    expect(() => fillTitle('{label}', { label: '   ' })).toThrow(TitleError);
  });
});

describe('fillLabel', () => {
  it('fills the number', () => {
    expect(fillLabel('District {n}', 3)).toBe('District 3');
    expect(fillLabel('Position {n}', 1)).toBe('Position 1');
  });

  it('throws on another token', () => {
    expect(() => fillLabel('District {letter}', 1)).toThrow(TitleError);
  });
});
