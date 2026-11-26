import { describe, expect, it } from 'vitest';
import { englishT } from '../i18n/format/english-t.fixtures.ts';

// L-alt-text is a key table with no function (D-535): each key is called here by its literal name.
const t = englishT();

describe('alt-text keys', () => {
  it('title', () => {
    expect(t('cards:alt.title', { office: 'County Treasurer', place: 'Polk County' })).toBe(
      'County Treasurer, Polk County.',
    );
  });

  it('pay by the year', () => {
    expect(t('cards:alt.pay', { amount: '$52,900' })).toBe('Pays $52,900 a year.');
    expect(t('cards:alt.pay_about', { amount: '$52,900' })).toBe('Pays about $52,900 a year.');
  });

  it('pay by the month', () => {
    expect(t('cards:alt.payMonth', { amount: '$300' })).toBe('Pays $300 a month.');
    expect(t('cards:alt.payMonth_about', { amount: '$300' })).toBe('Pays about $300 a month.');
  });

  it('pay by the meeting', () => {
    expect(t('cards:alt.payMeeting', { amount: '$100' })).toBe('Pays $100 per meeting.');
    expect(t('cards:alt.payMeeting_about', { amount: '$100' })).toBe(
      'Pays about $100 per meeting.',
    );
  });

  it('unpaid', () => {
    expect(t('cards:alt.payNone')).toBe('Unpaid.');
  });

  it('votes', () => {
    expect(t('cards:alt.votes', { count: 2100 })).toBe('2,100 votes to win.');
    expect(t('cards:alt.votes_about', { count: 2100 })).toBe('About 2,100 votes to win.');
  });

  it('deadline', () => {
    expect(t('cards:alt.deadline', { count: 12 })).toBe('Filing closes in 12 days.');
  });

  it('deadline with its date', () => {
    expect(t('cards:alt.deadlineOn', { count: 12, date: 'Friday, November 27, 2026' })).toBe(
      'Filing closes in 12 days, on Friday, November 27, 2026.',
    );
  });

  it('deadline today', () => {
    expect(t('cards:alt.deadlineToday')).toBe('Filing closes today.');
  });

  it('not open', () => {
    expect(t('cards:alt.opensIn', { count: 9 })).toBe('Filing opens in 9 days.');
  });

  it('closed', () => {
    expect(t('cards:alt.deadlineClosed')).toBe('Filing is closed.');
  });

  it('unknown', () => {
    expect(t('cards:alt.unknown.pay')).toBe('Pay not known yet.');
    expect(t('cards:alt.unknown.votes')).toBe('Votes to win not known yet.');
    expect(t('cards:alt.unknown.deadline')).toBe('Filing deadline not known yet.');
  });

  it('plurals resolve for 0, 1 and 2', () => {
    expect([0, 1, 2].map((count) => t('cards:alt.votes', { count }))).toEqual([
      '0 votes to win.',
      '1 vote to win.',
      '2 votes to win.',
    ]);
    expect([0, 1, 2].map((count) => t('cards:alt.votes_about', { count }))).toEqual([
      'About 0 votes to win.',
      'About 1 vote to win.',
      'About 2 votes to win.',
    ]);
    expect([0, 1, 2].map((count) => t('cards:alt.deadline', { count }))).toEqual([
      'Filing closes in 0 days.',
      'Filing closes in 1 day.',
      'Filing closes in 2 days.',
    ]);
    const date = 'Friday, November 27, 2026';
    expect([0, 1, 2].map((count) => t('cards:alt.deadlineOn', { count, date }))).toEqual([
      'Filing closes in 0 days, on Friday, November 27, 2026.',
      'Filing closes in 1 day, on Friday, November 27, 2026.',
      'Filing closes in 2 days, on Friday, November 27, 2026.',
    ]);
    expect([0, 1, 2].map((count) => t('cards:alt.opensIn', { count }))).toEqual([
      'Filing opens in 0 days.',
      'Filing opens in 1 day.',
      'Filing opens in 2 days.',
    ]);
  });

  it('the reference sentence composes from the keys', () => {
    const sentences = [
      t('cards:alt.title', { office: 'County Treasurer', place: 'Polk County' }),
      t('cards:alt.pay', { amount: '$52,900' }),
      t('cards:alt.votes_about', { count: 2100 }),
      t('cards:alt.deadlineOn', { count: 12, date: 'Friday, November 27, 2026' }),
    ];
    expect(sentences.join(' ')).toBe(
      'County Treasurer, Polk County. Pays $52,900 a year. About 2,100 votes to win. Filing closes in 12 days, on Friday, November 27, 2026.',
    );
  });
});
