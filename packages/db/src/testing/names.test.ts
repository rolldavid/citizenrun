import { describe, expect, it } from 'vitest';
import { bucketName, parseStamp, stampOf, templateName, workerDatabaseName } from './names.ts';

describe('harness names', () => {
  it('two slots get two databases', () => {
    const one = workerDatabaseName('202703052200', 'a1b2c3', '1');
    const two = workerDatabaseName('202703052200', 'a1b2c3', '2');
    expect(one).not.toBe(two);
    for (const name of [one, two]) {
      expect(name).toMatch(/^os_t_[0-9]{12}_[0-9a-f]{6}_[0-9]+$/);
    }
  });

  it('parses the stamp of a template name and returns null for an unrelated name', () => {
    expect(parseStamp(templateName('202703052200', '0123456789ab'))).toEqual(
      new Date('2027-03-05T22:00:00.000Z'),
    );
    expect(parseStamp(workerDatabaseName('202612312359', 'a1b2c3', '4'))).toEqual(
      new Date('2026-12-31T23:59:00.000Z'),
    );
    expect(parseStamp('citizenrun')).toBeNull();
    expect(parseStamp('os_mig_a1b2c3_1')).toBeNull();
    expect(parseStamp('os_tpl_202713052200_0123456789ab')).toBeNull();
  });

  it('names a bucket by run, slot and kind', () => {
    expect(bucketName('a1b2c3', '3', 'media')).toBe('t-a1b2c3-3-media');
  });

  it('stamps the UTC minute', () => {
    expect(stampOf(new Date('2027-03-05T22:00:59.999Z'))).toBe('202703052200');
    expect(stampOf(new Date('2027-01-02T03:04:00.000-05:00'))).toBe('202701020804');
  });
});
