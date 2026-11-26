import { rulesFor } from '@citizenrun/rules';
import { describe, expect, it } from 'vitest';
import { checkTemplates } from '../stages/s03-templates.ts';
import { repoRoot } from '../stages/shared/repo.ts';
import { loadReferenceIds } from '../stages/shared/reference.ts';
import { defaultTemplatesDir } from './load.ts';

describe('data/templates', () => {
  it('every template in the repository validates with its registered rules module', async () => {
    const lines = await checkTemplates({
      templatesDir: defaultTemplatesDir(),
      rulesFor,
      loadReference: () => loadReferenceIds(repoRoot()),
    });
    expect(lines.filter((line) => !line.ok)).toEqual([]);
  });
});
