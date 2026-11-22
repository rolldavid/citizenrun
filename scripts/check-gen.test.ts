import { describe, expect, it } from 'vitest';
import { changedGeneratedPaths } from './check-gen.ts';

describe('changedGeneratedPaths', () => {
  it('returns a modified generated file', () => {
    expect(changedGeneratedPaths(' M apps/api/openapi.json')).toEqual(['apps/api/openapi.json']);
  });

  it('returns an untracked file under a generated folder', () => {
    expect(changedGeneratedPaths('?? packages/shared/src/api/x.ts')).toEqual([
      'packages/shared/src/api/x.ts',
    ]);
  });

  it('returns nothing for a change outside the generated locations', () => {
    expect(changedGeneratedPaths(' M apps/api/src/app.ts')).toEqual([]);
  });

  it('returns added and deleted generated files and ignores a path that only starts like one', () => {
    const porcelain = [
      'A  packages/shared/src/brand.ts',
      ' D packages/cards/src/generated/icon.tsx',
      ' M packages/shared/src/brand.test.ts',
      '',
    ].join('\n');
    expect(changedGeneratedPaths(porcelain)).toEqual([
      'packages/shared/src/brand.ts',
      'packages/cards/src/generated/icon.tsx',
    ]);
  });
});
