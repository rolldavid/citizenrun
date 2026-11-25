import { describe, expect, it } from 'vitest';
import { IssuePageSchema, IssueSchema } from './reference.ts';

const HOUSING = { id: 'housing', name: 'Housing', icon: 'IssueHousing', sort: 1 };

describe('IssuePage', () => {
  it('an issue page has a null cursor', () => {
    expect(IssuePageSchema.parse({ items: [HOUSING], nextCursor: null })).toEqual({
      items: [HOUSING],
      nextCursor: null,
    });
    expect(IssuePageSchema.safeParse({ items: [HOUSING] }).success).toBe(false);
    expect(IssuePageSchema.meta()?.id).toBe('IssuePage');
  });
});

describe('Issue', () => {
  it('an issue carries no color key', () => {
    expect(IssueSchema.parse({ ...HOUSING, colorLight: '#123456', colorDark: '#654321' })).toEqual(
      HOUSING,
    );
    expect(Object.keys(IssueSchema.shape)).toEqual(['id', 'name', 'icon', 'sort']);
    expect(IssueSchema.meta()?.id).toBe('Issue');
  });

  it('an issue with a key missing fails', () => {
    expect(
      IssueSchema.safeParse({ id: 'housing', name: 'Housing', icon: 'IssueHousing' }).success,
    ).toBe(false);
  });
});
