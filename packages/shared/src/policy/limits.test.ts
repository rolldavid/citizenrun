import { describe, expect, it } from 'vitest';
import { LIMITS } from './limits.ts';

describe('LIMITS', () => {
  it('the client error limit is 4,096 bytes', () => {
    expect(LIMITS.clientErrorBytes).toBe(4096);
  });

  it('LIMITS holds the civic keys', () => {
    expect(Object.keys(LIMITS).sort()).toEqual([
      'clientErrorBytes',
      'fieldReportsPerDay',
      'followsPerDay',
      'reportNoteChars',
    ]);
  });

  it('the follow limit has a new-account value', () => {
    expect(LIMITS.followsPerDay).toEqual({ newAccount: 100, established: 400 });
  });

  it('field reports are ten a day', () => {
    expect(LIMITS.fieldReportsPerDay).toBe(10);
  });

  it('a report note is at most 1,000 characters', () => {
    expect(LIMITS.reportNoteChars).toBe(1000);
  });

  it('LIMITS repeats no constant another contract owns', () => {
    for (const key of [
      'bioChars',
      'nameChars',
      'emailCodeAttempts',
      'exportsPerDay',
      'uploadPhotoBytes',
    ]) {
      expect(LIMITS).not.toHaveProperty(key);
    }
  });
});
