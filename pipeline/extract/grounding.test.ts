import { describe, expect, it } from 'vitest';
import { isQuoteGrounded, skeletonKey, textKeys, tightKey } from './grounding.ts';

describe('tightKey', () => {
  it('removes a soft hyphen and U+200B, maps quotes and dashes, collapses whitespace and lower-cases', () => {
    const input =
      '  The Board\u00ADs \u2019Clerk\u2019 \u201CMay\u201D\u200B 3 \u2013 7,\n\t2027 \u2212 Noon ';
    expect(tightKey(input)).toBe('the boards \'clerk\' "may" 3 - 7, 2027 - noon');
  });

  it('applies NFKC', () => {
    expect(tightKey('\uFB01ling \u2460')).toBe('filing 1');
  });
});

describe('skeletonKey', () => {
  it('keeps only letters and digits', () => {
    expect(skeletonKey('The first Monday \u2014 in May, 2027!')).toBe('thefirstmondayinmay2027');
  });
});

describe('isQuoteGrounded', () => {
  const text =
    'Filings for office shall be made beginning the first Monday in May and ending the following Friday.\nNoon is the deadline.';
  const keys = textKeys(text);

  it('grounds a quote with other quote characters and spacing by the tight key', () => {
    const page = textKeys('He said \u201Cfile by noon\u201D on the \u2018last\u2019   day.');
    expect(isQuoteGrounded('said "file by noon" on the \'last\' day', page)).toBe(true);
  });

  it('grounds a quote that differs only in punctuation by its skeleton', () => {
    const quote = 'beginning-the first; Monday';
    expect(skeletonKey(quote)).toHaveLength(23);
    expect(tightKey(text).includes(tightKey(quote))).toBe(false);
    expect(isQuoteGrounded(quote, keys)).toBe(true);
  });

  it('grounds a skeleton of 20 characters and not one of 19', () => {
    const page = textKeys('abcdefghij klmnopqrst uvw');
    expect(skeletonKey('abcde-fghij-klmno-pqrst')).toHaveLength(20);
    expect(isQuoteGrounded('abcde-fghij-klmno-pqrst', page)).toBe(true);
    expect(skeletonKey('bcde-fghij-klmno-pqrst')).toHaveLength(19);
    expect(isQuoteGrounded('bcde-fghij-klmno-pqrst', page)).toBe(false);
  });

  it('does not ground a quote absent from the text', () => {
    expect(isQuoteGrounded('ending the following Monday', keys)).toBe(false);
  });
});
